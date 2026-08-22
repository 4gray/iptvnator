import type {
    ElectronRecordingItem,
    RecordingProgramSnapshot,
} from '@iptvnator/shared/interfaces';
import { desc, eq } from 'drizzle-orm';
import { ipcMain, shell } from 'electron';
import { stat, unlink } from 'node:fs/promises';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { embeddedMpvNativeService } from '../../services/embedded-mpv-native.service';
import { embeddedMpvRecordingTracker } from '../../services/embedded-mpv-recording-tracker';
import { getDownloadFileAvailabilityWithTimeoutAsync } from './download-file-availability';
import { broadcastRecordingsUpdate } from './recording-broadcast';
import {
    decodeRecordingPrograms,
    sanitizeRecordingPrograms,
} from './recording-programs';

type RecordingRow = schema.Recording;

const LIVE_SIZE_PROBE_TIMEOUT_MS = 1_000;

/**
 * Coalesced raw stat for an actively recorded file. Mirrors the availability
 * probe's contract: caller deadlines never evict the in-flight operation, so
 * a stat stalled on a slow network filesystem is not duplicated by every
 * manager refresh; completed results are dropped so growth stays visible.
 */
const inFlightSizeProbes = new Map<string, Promise<number | null>>();

function probeLiveFileSize(filePath: string): Promise<number | null> {
    const existing = inFlightSizeProbes.get(filePath);
    if (existing) {
        return existing;
    }
    const probe = stat(filePath).then(
        (stats) => (stats.isFile() ? stats.size : null),
        () => null
    );
    inFlightSizeProbes.set(filePath, probe);
    const clear = () => {
        if (inFlightSizeProbes.get(filePath) === probe) {
            inFlightSizeProbes.delete(filePath);
        }
    };
    void probe.then(clear, clear);
    return probe;
}

/**
 * Bytes on disk for a recording still being written. The tracker only
 * persists `file_size_bytes` at finalization, so the manager's active row
 * would otherwise report nothing while mpv keeps growing the file. The stat
 * is bounded: `RECORDINGS_GET_LIST` awaits every decorator, so one stat
 * hanging on an unreachable filesystem must degrade to "no size" instead of
 * wedging every manager refresh.
 */
async function liveFileSizeBytes(filePath: string): Promise<number | null> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), LIVE_SIZE_PROBE_TIMEOUT_MS);
    });
    try {
        return await Promise.race([probeLiveFileSize(filePath), timedOut]);
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}

async function decorateRecordingItem(
    row: RecordingRow
): Promise<ElectronRecordingItem> {
    // Recordings reuse the download availability probe (bounded lstat with
    // in-flight coalescing) through the variant that preserves 'unknown':
    // a timed-out or errored probe is not proof of absence, and collapsing
    // it to 'missing' would move a good recording on a slow mount to Needs
    // attention and hide its Play/Reveal actions. 'interrupted' partials
    // are playable files, so they are probed exactly like completed rows;
    // 'recording' and 'failed' map to a non-completed status and come back
    // 'not-applicable'.
    const fileAvailability = await getDownloadFileAvailabilityWithTimeoutAsync({
        filePath: row.filePath,
        status:
            row.status === 'completed' || row.status === 'interrupted'
                ? 'completed'
                : 'failed',
    });

    const fileSizeBytes =
        row.status === 'recording'
            ? ((await liveFileSizeBytes(row.filePath)) ?? undefined)
            : (row.fileSizeBytes ?? undefined);

    return {
        id: row.id,
        sessionId: row.sessionId ?? undefined,
        status: row.status,
        filePath: row.filePath,
        fileSizeBytes,
        channelName: row.channelName,
        channelLogoUrl: row.channelLogoUrl ?? undefined,
        playlistId: row.playlistId ?? undefined,
        playlistName: row.playlistName ?? undefined,
        sourceType: row.sourceType ?? undefined,
        epgChannelId: row.epgChannelId ?? undefined,
        programTitle: row.programTitle ?? undefined,
        programDescription: row.programDescription ?? undefined,
        programStart: row.programStart ?? undefined,
        programStop: row.programStop ?? undefined,
        programs: decodeRecordingPrograms(row.programsJson),
        errorMessage: row.errorMessage ?? undefined,
        startedAt: row.startedAt,
        endedAt: row.endedAt ?? undefined,
        createdAt: row.createdAt ?? undefined,
        updatedAt: row.updatedAt ?? undefined,
        fileAvailability,
    };
}

/**
 * Shell-touching IPCs may only operate on paths the main process itself
 * reserved via `reserveRecordingTargetPath` — the renderer-supplied recording
 * directory is a write-location preference, not a shell-access grant.
 */
async function isManagedRecordingFile(filePath: string): Promise<boolean> {
    if (!filePath) {
        return false;
    }
    try {
        const db = await getDatabase();
        const rows = await db
            .select({ id: schema.recordings.id })
            .from(schema.recordings)
            .where(eq(schema.recordings.filePath, filePath))
            .limit(1);
        return rows.length > 0;
    } catch (error) {
        console.error('Error verifying managed recording path:', error);
        return false;
    }
}

ipcMain.handle('RECORDINGS_GET_LIST', async (_event, playlistId?: string) => {
    try {
        const db = await getDatabase();
        const query = db.select().from(schema.recordings);
        const rows = await (playlistId
            ? query
                  .where(eq(schema.recordings.playlistId, playlistId))
                  .orderBy(desc(schema.recordings.startedAt))
            : query.orderBy(desc(schema.recordings.startedAt)));
        return Promise.all(rows.map((row) => decorateRecordingItem(row)));
    } catch (error) {
        console.error('[Recordings] Error getting recording list:', error);
        throw error;
    }
});

ipcMain.handle('RECORDINGS_GET', async (_event, recordingId: number) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select()
            .from(schema.recordings)
            .where(eq(schema.recordings.id, recordingId))
            .limit(1);
        return result[0] ? await decorateRecordingItem(result[0]) : null;
    } catch (error) {
        console.error('[Recordings] Error getting recording:', error);
        throw error;
    }
});

ipcMain.handle('RECORDINGS_STOP', async (_event, recordingId: number) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select()
            .from(schema.recordings)
            .where(eq(schema.recordings.id, recordingId))
            .limit(1);
        const row = result[0];
        if (!row || row.status !== 'recording' || !row.sessionId) {
            return { error: 'Recording is not active', success: false };
        }
        // Session ids restart per process, so under
        // IPTVNATOR_ALLOW_MULTIPLE_INSTANCES another instance's row can name
        // a session id that exists locally as an unrelated recording. Only
        // the owning process may stop it.
        if (
            row.ownerPid !== null &&
            row.ownerPid !== undefined &&
            row.ownerPid !== process.pid
        ) {
            return {
                error: 'Recording belongs to another IPTVnator instance',
                success: false,
            };
        }
        // Finalization (status, ended_at, file size, broadcast) happens in
        // the recording tracker's stop hook, exactly like a stop from the
        // player controls.
        embeddedMpvNativeService.stopRecording(row.sessionId);
        return { success: true };
    } catch (error) {
        console.error('[Recordings] Error stopping recording:', error);
        return {
            error: error instanceof Error ? error.message : 'Stop failed',
            success: false,
        };
    }
});

ipcMain.handle('RECORDINGS_REMOVE', async (_event, recordingId: number) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select()
            .from(schema.recordings)
            .where(eq(schema.recordings.id, recordingId))
            .limit(1);
        const row = result[0];
        if (!row) {
            return { error: 'Recording not found', success: false };
        }
        if (row.status === 'recording') {
            return {
                error: 'Stop the recording before removing it',
                success: false,
            };
        }
        // Finished recordings keep their file on disk (same contract as
        // completed downloads); only a failed row's leftover reservation is
        // cleaned up best-effort — and only while no other row claims that
        // path. A retry within the same timestamp second reuses the freed
        // name, and unlinking then would take the newer recording's file
        // (mpv would keep writing to an inode nobody can reach).
        if (row.status === 'failed' && row.filePath) {
            const otherOwners = await db
                .select({ id: schema.recordings.id })
                .from(schema.recordings)
                .where(eq(schema.recordings.filePath, row.filePath))
                .limit(2);
            const pathIsExclusive = otherOwners.every(
                (candidate) => candidate.id === row.id
            );
            if (pathIsExclusive) {
                // Bounded: a hung network unlink must not keep the Remove
                // action busy — deleting the row is what matters, and the
                // cleanup contract is best-effort anyway.
                let unlinkDeadline:
                    | ReturnType<typeof setTimeout>
                    | undefined;
                await Promise.race([
                    unlink(row.filePath).catch(() => undefined),
                    new Promise<void>((resolve) => {
                        unlinkDeadline = setTimeout(
                            resolve,
                            LIVE_SIZE_PROBE_TIMEOUT_MS
                        );
                    }),
                ]);
                if (unlinkDeadline !== undefined) {
                    clearTimeout(unlinkDeadline);
                }
            }
        }
        await db
            .delete(schema.recordings)
            .where(eq(schema.recordings.id, recordingId));
        broadcastRecordingsUpdate();
        return { success: true };
    } catch (error) {
        console.error('[Recordings] Error removing recording:', error);
        return {
            error: error instanceof Error ? error.message : 'Remove failed',
            success: false,
        };
    }
});

ipcMain.handle(
    'RECORDINGS_UPDATE_PROGRAMS',
    async (
        _event,
        targetPath: string,
        programs: RecordingProgramSnapshot[]
    ) => {
        try {
            const sanitized = sanitizeRecordingPrograms(programs);
            if (!targetPath || sanitized === null) {
                return { error: 'Invalid programs payload', success: false };
            }
            // Only guarantees the row's INSERT has committed — a recording
            // stopped within milliseconds of starting. Enrichment does not
            // wait for finalization: the row is found in any status and
            // `finalize()` never touches `programs_json`, so the two writes
            // are order-independent and no deadline can drop the programs.
            await embeddedMpvRecordingTracker.whenSettled();
            const db = await getDatabase();
            // `openSync('wx')` makes the reserved path exclusive while a
            // recording owns it, so the newest row for that path is the
            // recording that was just stopped — whatever status it currently
            // carries.
            const rows = await db
                .select()
                .from(schema.recordings)
                .where(eq(schema.recordings.filePath, targetPath))
                .orderBy(desc(schema.recordings.id))
                .limit(1);
            const row = rows[0];
            if (!row) {
                return { error: 'Recording not found', success: false };
            }
            const first = sanitized[0];
            await db
                .update(schema.recordings)
                .set({
                    programsJson: JSON.stringify(sanitized),
                    // Backfill the headline program only when the start
                    // snapshot had none — the program airing at start stays
                    // authoritative for the title.
                    ...(row.programTitle || !first
                        ? {}
                        : {
                              programTitle: first.title,
                              programDescription: first.description,
                              programStart: first.start,
                              programStop: first.stop,
                          }),
                    updatedAt: new Date().toISOString(),
                })
                .where(eq(schema.recordings.id, row.id));
            broadcastRecordingsUpdate();
            return { success: true };
        } catch (error) {
            console.error('[Recordings] Error updating programs:', error);
            return {
                error: error instanceof Error ? error.message : 'Update failed',
                success: false,
            };
        }
    }
);

/**
 * Bounded pre-shell gate: only PROVEN absence refuses the action. The
 * synchronous lstat variant would block the main process on a dead mount,
 * and an inconclusive probe (timeout, permission error) must still let the
 * shell try — the OS gives the honest answer either way.
 */
async function isRecordingFileMissing(filePath: string): Promise<boolean> {
    const availability = await getDownloadFileAvailabilityWithTimeoutAsync({
        filePath,
        status: 'completed',
    });
    return availability === 'missing';
}

ipcMain.handle('RECORDINGS_REVEAL_FILE', async (_event, filePath: string) => {
    if (
        !(await isManagedRecordingFile(filePath)) ||
        (await isRecordingFileMissing(filePath))
    ) {
        return { error: 'File not found', success: false };
    }
    shell.showItemInFolder(filePath);
    return { success: true };
});

ipcMain.handle('RECORDINGS_PLAY_FILE', async (_event, filePath: string) => {
    if (
        !(await isManagedRecordingFile(filePath)) ||
        (await isRecordingFileMissing(filePath))
    ) {
        return { error: 'File not found', success: false };
    }
    const error = await shell.openPath(filePath);
    if (!error) {
        return { success: true };
    }
    return (await isRecordingFileMissing(filePath))
        ? { error: 'File not found', success: false }
        : { error, success: false };
});
