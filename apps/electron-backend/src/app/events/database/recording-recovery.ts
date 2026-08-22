import { execFileSync } from 'child_process';
import { eq } from 'drizzle-orm';
import { stat } from 'node:fs/promises';
import { basename } from 'path';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { embeddedMpvRecordingTracker } from '../../services/embedded-mpv-recording-tracker';
import { broadcastRecordingsUpdate } from './recording-broadcast';

const RECOVERY_STAT_TIMEOUT_MS = 3_000;

type RecordedFileProbe =
    | { kind: 'size'; size: number }
    | { kind: 'missing' }
    | { kind: 'unknown' };

/**
 * Bounded, asynchronous stat: the recording directory is user-selected and
 * can sit on an unreachable network filesystem, which must not block startup
 * or fail a row it cannot actually see. Only proven absence
 * (`ENOENT`/`ENOTDIR`) reports `missing`; timeouts and every other error
 * stay `unknown`.
 */
async function probeRecordedFile(filePath: string): Promise<RecordedFileProbe> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<RecordedFileProbe>((resolve) => {
        timeout = setTimeout(
            () => resolve({ kind: 'unknown' }),
            RECOVERY_STAT_TIMEOUT_MS
        );
    });
    const probe = stat(filePath).then(
        (stats): RecordedFileProbe =>
            stats.isFile()
                ? { kind: 'size', size: stats.size }
                : { kind: 'missing' },
        (error): RecordedFileProbe => {
            const code = (error as NodeJS.ErrnoException)?.code;
            return code === 'ENOENT' || code === 'ENOTDIR'
                ? { kind: 'missing' }
                : { kind: 'unknown' };
        }
    );
    try {
        return await Promise.race([probe, timedOut]);
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
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
/**
 * Bound for each synchronous `ps`/`tasklist`/PowerShell spawn. The probes
 * run on the main thread once per unique pid (memoized per pass), so a hung
 * process query degrades to the conservative fallback instead of blocking
 * startup indefinitely.
 */
const PROCESS_PROBE_TIMEOUT_MS = 2_000;

function processLooksLikeOwnInstance(pid: number): boolean {
    try {
        const output =
            process.platform === 'win32'
                ? execFileSync(
                      'tasklist',
                      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
                      { encoding: 'utf8', timeout: PROCESS_PROBE_TIMEOUT_MS }
                  )
                : execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
                      encoding: 'utf8',
                      timeout: PROCESS_PROBE_TIMEOUT_MS,
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
 * Milliseconds tolerance before a process start time counts as "after" the
 * recording start — absorbs `etime`'s one-second granularity and small clock
 * drift without weakening the recycled-pid discrimination.
 */
const START_TIME_TOLERANCE_MS = 5_000;

/** `[[dd-]hh:]mm:ss` from `ps -o etime=` → seconds, or null. */
function parseEtimeSeconds(etime: string): number | null {
    const match = /^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(etime);
    if (!match) {
        return null;
    }
    const [, days, hours, minutes, seconds] = match;
    return (
        (days ? Number(days) * 86_400 : 0) +
        (hours ? Number(hours) * 3_600 : 0) +
        Number(minutes) * 60 +
        Number(seconds)
    );
}

function processStartTimeMs(pid: number): number | null {
    try {
        if (process.platform === 'win32') {
            const iso = execFileSync(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-Command',
                    `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
                ],
                { encoding: 'utf8', timeout: PROCESS_PROBE_TIMEOUT_MS }
            ).trim();
            const parsed = Date.parse(iso);
            return Number.isFinite(parsed) ? parsed : null;
        }
        const etime = execFileSync(
            'ps',
            ['-p', String(pid), '-o', 'etime='],
            { encoding: 'utf8', timeout: PROCESS_PROBE_TIMEOUT_MS }
        ).trim();
        const elapsedSeconds = parseEtimeSeconds(etime);
        return elapsedSeconds === null
            ? null
            : Date.now() - elapsedSeconds * 1_000;
    } catch {
        return null;
    }
}

/**
 * True only when the process behind `pid` PROVABLY started after the
 * recording did. A pid can only be recycled once its previous holder died,
 * and the recording's real owner was necessarily already running when it
 * created the row — so a same-family process name (any Electron app) cannot
 * shield a recycled pid whose holder is younger than the recording.
 * Unreadable start times return false (conservative: keep the skip).
 */
function provablyStartedAfter(
    processStartMs: number | null,
    startedAt: string
): boolean {
    const recordingStartMs = Date.parse(startedAt);
    if (!Number.isFinite(recordingStartMs)) {
        return false;
    }
    if (processStartMs === null) {
        return false;
    }
    return processStartMs > recordingStartMs + START_TIME_TOLERANCE_MS;
}

/**
 * Startup repair for recordings the previous app run left in status
 * 'recording' (hard kill, crash, power loss). mpv muxes MPEG-TS
 * continuously, so a file with real bytes is a playable partial recording
 * ('interrupted'); an absent or empty file means nothing usable was captured
 * ('failed').
 *
 * Rows whose owner process is still alive are skipped — but only when it
 * also looks like an IPTVnator/Electron process AND cannot be proven to have
 * started after the recording did. A recycled pid's holder is necessarily
 * younger than the recording (the pid frees only when its previous owner
 * dies), so the start-time check unmasks even a recycled pid that landed on
 * another Electron app; unreadable names or start times stay conservative
 * and keep the skip. The skip matters with
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

        // Rows from one crashed instance share a pid: memoize the (bounded,
        // synchronous) process probes so each unique pid costs at most one
        // name query and one start-time query per pass.
        const nameVerdicts = new Map<number, boolean>();
        const startTimes = new Map<number, number | null>();
        const looksLikeOwnInstance = (pid: number): boolean => {
            let verdict = nameVerdicts.get(pid);
            if (verdict === undefined) {
                verdict = processLooksLikeOwnInstance(pid);
                nameVerdicts.set(pid, verdict);
            }
            return verdict;
        };
        const startTimeOf = (pid: number): number | null => {
            if (!startTimes.has(pid)) {
                startTimes.set(pid, processStartTimeMs(pid));
            }
            return startTimes.get(pid) ?? null;
        };

        const candidates = stale.filter((row) => {
            if (liveRowIds.has(row.id)) {
                return false;
            }
            return !(
                row.ownerPid !== null &&
                row.ownerPid !== undefined &&
                row.ownerPid !== process.pid &&
                isProcessAlive(row.ownerPid) &&
                looksLikeOwnInstance(row.ownerPid) &&
                !provablyStartedAfter(
                    startTimeOf(row.ownerPid),
                    row.startedAt
                )
            );
        });

        // Probe concurrently: each probe carries its own deadline, so a
        // batch of rows on a dead mount costs one deadline for the whole
        // pass instead of one per row (main.ts awaits this function).
        const probes = await Promise.all(
            candidates.map((row) => probeRecordedFile(row.filePath))
        );

        let repairedRows = 0;
        for (let i = 0; i < candidates.length; i += 1) {
            const row = candidates[i];
            const probe = probes[i];
            if (probe.kind === 'unknown') {
                // Cannot see the file right now — leave the row in
                // 'recording' so a later startup can repair it honestly.
                continue;
            }
            const size = probe.kind === 'size' ? probe.size : null;
            const playable = size !== null && size > 0;
            await db
                .update(schema.recordings)
                .set({
                    status: playable ? 'interrupted' : 'failed',
                    fileSizeBytes: playable ? size : null,
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
