import { execFileSync } from 'child_process';
import { eq } from 'drizzle-orm';
import { statSync } from 'fs';
import { basename } from 'path';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { embeddedMpvRecordingTracker } from '../../services/embedded-mpv-recording-tracker';
import { broadcastRecordingsUpdate } from './recording-broadcast';

function recordedFileSize(filePath: string): number | null {
    try {
        const stats = statSync(filePath);
        return stats.isFile() ? stats.size : null;
    } catch {
        return null;
    }
}

/**
 * True when `pid` belongs to a process that is still running. Signal 0 only
 * probes for existence; EPERM means the process exists but is owned by
 * someone else, which still counts as alive.
 */
function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/**
 * Best-effort check that the live process behind `pid` looks like another
 * IPTVnator/Electron instance. After a crash the OS can hand the persisted
 * `ownerPid` to an unrelated process before IPTVnator restarts; bare
 * `kill(pid, 0)` liveness would then skip the row on every startup while no
 * instance can ever finalize it. When the name cannot be read the answer
 * stays `true` — never repair a row a live peer might still own.
 */
function processLooksLikeOwnInstance(pid: number): boolean {
    try {
        const output =
            process.platform === 'win32'
                ? execFileSync(
                      'tasklist',
                      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
                      { encoding: 'utf8' }
                  )
                : execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
                      encoding: 'utf8',
                  });
        const name = output.trim().toLowerCase();
        if (!name) {
            return true;
        }
        const ownExecutable = basename(process.execPath).toLowerCase();
        return (
            name.includes('iptvnator') ||
            name.includes('electron') ||
            (ownExecutable.length > 0 && name.includes(ownExecutable))
        );
    } catch {
        return true;
    }
}

/**
 * Startup repair for recordings the previous app run left in status
 * 'recording' (hard kill, crash, power loss). mpv muxes MPEG-TS
 * continuously, so a file with real bytes is a playable partial recording
 * ('interrupted'); an absent or empty file means nothing usable was captured
 * ('failed').
 *
 * Rows whose owner process is still alive (and still looks like an
 * IPTVnator/Electron process — a recycled pid must not shield the row) are
 * skipped: with
 * IPTVNATOR_ALLOW_MULTIPLE_INSTANCES a second instance shares this database,
 * and its startup must not terminate a recording the first one is actively
 * writing (the tracker's own update is guarded on status 'recording', so the
 * row would never get its real end time or size).
 *
 * Rows this process is itself tracking are skipped too: the renderer is
 * interactive before this pass runs, so a recording started during bootstrap
 * carries `ownerPid === process.pid` — indistinguishable by pid from a
 * recycled-pid leftover, but alive by the tracker's own ledger.
 */
export async function reconcileStaleRecordings(): Promise<void> {
    try {
        const db = await getDatabase();
        const stale = await db
            .select()
            .from(schema.recordings)
            .where(eq(schema.recordings.status, 'recording'));
        // Resolved after the SELECT: any row the query saw was enqueued by a
        // tracker entry that already exists, so awaiting the tracked row ids
        // here cannot miss it.
        const liveRowIds = await embeddedMpvRecordingTracker.activeRowIds();

        let repairedRows = 0;
        for (const row of stale) {
            if (liveRowIds.has(row.id)) {
                continue;
            }
            if (
                row.ownerPid !== null &&
                row.ownerPid !== undefined &&
                row.ownerPid !== process.pid &&
                isProcessAlive(row.ownerPid) &&
                processLooksLikeOwnInstance(row.ownerPid)
            ) {
                continue;
            }

            const fileSize = recordedFileSize(row.filePath);
            const playable = fileSize !== null && fileSize > 0;
            await db
                .update(schema.recordings)
                .set({
                    status: playable ? 'interrupted' : 'failed',
                    fileSizeBytes: playable ? fileSize : null,
                    endedAt: row.endedAt ?? new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                })
                .where(eq(schema.recordings.id, row.id));
            repairedRows += 1;
        }

        if (repairedRows > 0) {
            // The renderer loads before this pass runs and may already hold
            // the pre-repair list (with a stale Stop affordance); tell it.
            broadcastRecordingsUpdate();
        }
    } catch (error) {
        console.error('[Recordings] Stale-recording repair failed:', error);
    }
}
