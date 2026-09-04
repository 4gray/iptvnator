import { randomUUID } from 'crypto';
import { mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';

const OPTIONS_ROOT = 'embedded-mpv';
const INSTANCE_DIRECTORY_PREFIX = 'options-';
const OPTIONS_FILE_PREFIX = 'session-options-';

/**
 * Linux native-view runs mpv as a separate process whose command line is
 * readable by every local user through /proc/<pid>/cmdline, so the session
 * options (which may carry request headers with credentials) are handed
 * over as an mpv config file readable by the owner only and referenced with
 * `--include=<path>`. Files live under a per-instance directory named by the
 * owning process id: a session removes its file on dispose, the instance
 * removes its directory on shutdown, and a crashed instance's leftovers are
 * swept by the next one — but only once its process is gone, because two
 * instances may share one `userData` (IPTVNATOR_ALLOW_MULTIPLE_INSTANCES=1).
 */
export function resolveSessionOptionsRoot(userDataPath: string): string {
    return path.join(userDataPath, OPTIONS_ROOT);
}

export function resolveSessionOptionsDirectory(
    root: string,
    pid: number = process.pid
): string {
    return path.join(root, `${INSTANCE_DIRECTORY_PREFIX}${pid}`);
}

export function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM: the process exists but belongs to someone else.
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

export function sweepSessionOptionsFiles(
    root: string,
    options: { ownPid?: number; isAlive?: (pid: number) => boolean } = {}
): void {
    const ownPid = options.ownPid ?? process.pid;
    const isAlive = options.isAlive ?? isProcessAlive;
    let names: string[];
    try {
        names = readdirSync(root);
    } catch {
        return;
    }
    for (const name of names) {
        if (!name.startsWith(INSTANCE_DIRECTORY_PREFIX)) {
            continue;
        }
        const pid = Number(name.slice(INSTANCE_DIRECTORY_PREFIX.length));
        if (!Number.isInteger(pid) || pid === ownPid || isAlive(pid)) {
            continue;
        }
        rmSync(path.join(root, name), { recursive: true, force: true });
    }
}

export function writeSessionOptionsFile(
    directory: string,
    options: readonly string[]
): string {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(
        directory,
        `${OPTIONS_FILE_PREFIX}${randomUUID()}.conf`
    );
    writeFileSync(file, options.map((option) => `${option}\n`).join(''), {
        mode: 0o600,
    });
    return file;
}

export function removeSessionOptionsFile(file: string | null): void {
    if (!file) {
        return;
    }
    try {
        unlinkSync(file);
    } catch {
        // Already gone (a swept or never-written file); nothing to keep.
    }
}

export function removeSessionOptionsDirectory(directory: string | null): void {
    if (!directory) {
        return;
    }
    rmSync(directory, { recursive: true, force: true });
}
