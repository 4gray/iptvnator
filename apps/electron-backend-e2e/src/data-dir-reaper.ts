import {
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const dataDirPrefix = 'iptvnator-electron-e2e-';
export const dataDirOwnerMarker = '.e2e-owner-pid';
/** Fallback cutoff, used only for leftovers whose owner cannot be determined. */
export const orphanDataDirMaxAgeMs = 24 * 60 * 60 * 1000;
/**
 * Backstop for pid reuse. A pid that looks alive is normally decisive, but the
 * OS recycles pids — aggressively so on the long-lived Windows runners this
 * sweep exists for — and an unrelated service inheriting an abandoned run's pid
 * would otherwise pin that directory forever, defeating the whole point. No
 * suite survives a week, so past this age a live-looking pid is a stranger.
 */
export const dataDirHardMaxAgeMs = 7 * 24 * 60 * 60 * 1000;

export type DataDirOwner = 'alive' | 'dead' | 'unknown';

/**
 * Records the current process as the owner of `dataDir`.
 *
 * Written to a temporary name and renamed into place, because `writeFileSync`
 * creates the file before its bytes land: a concurrent sweep could otherwise
 * observe an empty marker and misjudge a starting run. `rename` is atomic
 * within a filesystem, so the marker is either absent or complete.
 */
export function writeDataDirOwnerMarker(dataDir: string): void {
    const markerPath = join(dataDir, dataDirOwnerMarker);
    const pendingPath = `${markerPath}.pending`;
    writeFileSync(pendingPath, String(process.pid));
    renameSync(pendingPath, markerPath);
}

/**
 * Resolves whether the run that created `dataDir` is still alive.
 *
 * Directory age cannot answer this. The suite writes beneath `databases/` and
 * `user-data/`, which never refreshes the root's mtime, so a run paused in a
 * debugger or blocked on a native process looks arbitrarily old while still
 * using its data — and Unix would let a sweep unlink files the live Electron
 * still has open. So the owner is asked of the OS directly.
 *
 * `unknown` covers a missing, unreadable, empty or malformed marker. Callers
 * must treat it as "cannot tell", never as "dead".
 */
export function readDataDirOwner(dataDir: string): DataDirOwner {
    let raw: string;
    try {
        raw = readFileSync(join(dataDir, dataDirOwnerMarker), 'utf8').trim();
    } catch {
        return 'unknown';
    }

    const pid = Number.parseInt(raw, 10);
    if (!raw || !Number.isInteger(pid) || pid <= 0 || String(pid) !== raw) {
        return 'unknown';
    }

    try {
        // Signal 0 runs the existence/permission check without delivering.
        process.kill(pid, 0);
        return 'alive';
    } catch (error) {
        // EPERM means the pid exists but belongs to another user — still alive.
        return (error as NodeJS.ErrnoException).code === 'EPERM'
            ? 'alive'
            : 'dead';
    }
}

/**
 * Best-effort sweep of data directories abandoned by earlier runs.
 *
 * `removeDataDir` tolerates a locked directory rather than failing the run, but
 * then abandons it, and nothing collects it on our behalf: Windows never clears
 * %TEMP% on process exit, and the Unix equivalents only run on a schedule. So
 * every teardown that loses that race leaks a database and user-data tree on a
 * developer machine or a long-lived self-hosted runner, invisibly.
 *
 * A live owner is kept — this repo is routinely checked out into several
 * worktrees at once — up to `dataDirHardMaxAgeMs`, past which the pid is
 * assumed recycled rather than still ours. A dead owner is collected at once,
 * since the pid settles what age only guesses at. An undeterminable owner
 * falls back to `orphanDataDirMaxAgeMs`.
 */
export function reapOrphanedDataDirs(root: string = tmpdir()): void {
    const now = Date.now();
    let entries: string[];
    try {
        entries = readdirSync(root);
    } catch {
        return;
    }

    for (const entry of entries) {
        if (!entry.startsWith(dataDirPrefix)) {
            continue;
        }

        const candidate = join(root, entry);
        try {
            const owner = readDataDirOwner(candidate);
            const age = now - statSync(candidate).mtimeMs;
            if (owner === 'alive' && age < dataDirHardMaxAgeMs) {
                continue;
            }
            if (owner === 'unknown' && age < orphanDataDirMaxAgeMs) {
                continue;
            }
            rmSync(candidate, { force: true, recursive: true, maxRetries: 3 });
        } catch {
            // Still locked, or owned by another user — leave it for next time.
        }
    }
}
