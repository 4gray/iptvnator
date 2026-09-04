import { randomUUID } from 'crypto';
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';

const OPTIONS_DIRECTORY = 'embedded-mpv';
const OPTIONS_FILE_PREFIX = 'session-options-';

/**
 * Linux native-view runs mpv as a separate process whose command line is
 * readable by every local user through /proc/<pid>/cmdline, so the session
 * options (which may carry request headers with credentials) are handed
 * over as an mpv config file readable by the owner only and referenced with
 * `--include=<path>`. One file per session: removed when the session is
 * disposed, and stale ones from a crashed run are swept on the next start.
 */
export function resolveSessionOptionsDirectory(userDataPath: string): string {
    return path.join(userDataPath, OPTIONS_DIRECTORY);
}

export function sweepSessionOptionsFiles(directory: string): void {
    let names: string[];
    try {
        names = readdirSync(directory);
    } catch {
        return;
    }
    for (const name of names) {
        if (name.startsWith(OPTIONS_FILE_PREFIX)) {
            removeSessionOptionsFile(path.join(directory, name));
        }
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
