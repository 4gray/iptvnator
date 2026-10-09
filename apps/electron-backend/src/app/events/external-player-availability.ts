import { constants } from 'fs';
import { access, readdir, stat } from 'fs/promises';
import path from 'path';
import {
    normalizeCustomPlayerPath,
    resolveExternalPlayerLaunchContext,
} from './external-player-launch-context';
import {
    defaultExternalPlayerPaths,
    VLC_CASKROOM_PATH,
} from './external-player-default-paths';

const PROBE_LIMIT_MS = 1_500;
const INCONCLUSIVE = Symbol('inconclusive player availability');
const configuredPoolSize = Number.parseInt(
    process.env.UV_THREADPOOL_SIZE ?? '4',
    10
);
// Leave at least one worker for unrelated filesystem work. With a single
// worker (or an invalid pool setting), detection remains unknown without I/O.
const MAX_ACTIVE_FILE_CHECKS = Number.isFinite(configuredPoolSize)
    ? Math.max(0, Math.min(2, configuredPoolSize - 1))
    : 0;
let activeFileChecks = 0;

// Node cannot cancel an in-flight filesystem request. Bound outstanding work
// too, so repeated edits cannot fill its thread pool with stalled network I/O.
async function fileCheck<T>(operation: () => Promise<T>): Promise<T> {
    if (activeFileChecks >= MAX_ACTIVE_FILE_CHECKS) throw INCONCLUSIVE;
    activeFileChecks++;
    try {
        return await operation();
    } finally {
        activeFileChecks--;
    }
}

function confirmedMissing(error: unknown, file: string): boolean {
    const code = (error as NodeJS.ErrnoException)?.code;
    const normalized = file.replace(/\//g, '\\').toLowerCase();
    const networkPath =
        normalized.startsWith('\\\\?\\unc\\') ||
        (normalized.startsWith('\\\\') &&
            !normalized.startsWith('\\\\?\\') &&
            !normalized.startsWith('\\\\.\\'));
    // Windows may report ENOENT for an offline UNC share. Permissions and
    // other I/O errors also cannot establish absence, even on a local path.
    return !networkPath && ['ENOENT', 'ENOTDIR'].includes(code ?? '');
}

async function pathExists(file: string): Promise<boolean> {
    try {
        await fileCheck(() => access(file, constants.F_OK));
        return true;
    } catch (error) {
        if (confirmedMissing(error, file)) return false;
        throw error;
    }
}

async function readDirectory(directory: string): Promise<string[]> {
    try {
        return await fileCheck(() => readdir(directory));
    } catch (error) {
        if (confirmedMissing(error, directory)) return [];
        throw error;
    }
}

async function executableFile(
    file: string,
    platform: NodeJS.Platform,
    expired: () => boolean
): Promise<boolean> {
    try {
        const info = await fileCheck(() => stat(file));
        if (expired()) throw INCONCLUSIVE;
        if (!info.isFile()) return false;
        await fileCheck(() =>
            access(file, platform === 'win32' ? constants.F_OK : constants.X_OK)
        );
        return true;
    } catch (error) {
        if (confirmedMissing(error, file)) return false;
        throw error;
    }
}

/** Check the command playback will launch without starting a player. */
export async function externalPlayerAvailable(
    player: 'mpv' | 'vlc',
    customPath?: string,
    options: {
        platform?: NodeJS.Platform;
        searchPath?: string;
        isFlatpak?: boolean;
        executable?: (file: string) => boolean | Promise<boolean>;
        pathExists?: (file: string) => boolean | Promise<boolean>;
        readDirectory?: (directory: string) => string[] | Promise<string[]>;
        waitForSearchPath?: () => Promise<boolean | void>;
        workingDirectory?: string;
        limitMs?: number;
    } = {}
): Promise<boolean | null> {
    const platform = options.platform ?? process.platform;
    let expired = false;
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
            expired = true;
            resolve(null);
        }, options.limitMs ?? PROBE_LIMIT_MS);
    });
    async function read<T>(operation: () => T | Promise<T>): Promise<T> {
        if (expired) throw INCONCLUSIVE;
        const result = await operation();
        if (expired) throw INCONCLUSIVE;
        return result;
    }
    async function probe(): Promise<boolean | null> {
        const exists = options.pathExists ?? pathExists;
        const isFlatpak =
            options.isFlatpak ??
            (platform === 'linux' &&
                (await read(() => exists('/.flatpak-info'))));
        if (platform === 'linux' && isFlatpak) return null;
        let playerPath = normalizeCustomPlayerPath(customPath);
        if (!playerPath) {
            const caskEntries =
                platform === 'darwin' && player === 'vlc'
                    ? await read(() =>
                          (options.readDirectory ?? readDirectory)(
                              VLC_CASKROOM_PATH
                          )
                      )
                    : [];
            for (const candidate of defaultExternalPlayerPaths(
                player,
                platform,
                caskEntries
            )) {
                if (await read(() => exists(candidate))) {
                    playerPath = candidate;
                    break;
                }
            }
        }
        // An explicit path and Flatpak state prevent the launch resolver from
        // invoking its synchronous default-install filesystem discovery.
        const { command } = resolveExternalPlayerLaunchContext(
            player,
            playerPath ?? player,
            { platform, isFlatpak }
        );
        const paths = platform === 'win32' ? path.win32 : path.posix;
        const executable =
            options.executable ??
            ((file) => executableFile(file, platform, () => expired));
        const names =
            platform === 'win32'
                ? [command, command + '.com', command + '.exe']
                : [command];
        async function anyExecutable(files: string[]): Promise<boolean> {
            for (const file of files) {
                if (await read(() => executable(file))) return true;
            }
            return false;
        }
        if (paths.isAbsolute(command) || /[\\/]/.test(command)) {
            return anyExecutable(names);
        }
        if (
            options.waitForSearchPath &&
            (await read(options.waitForSearchPath)) === false
        ) {
            return null;
        }
        const cwd = options.workingDirectory ?? process.cwd();
        if (
            platform === 'win32' &&
            (await anyExecutable(names.map((name) => paths.join(cwd, name))))
        ) {
            return true;
        }
        for (const directory of (
            options.searchPath ??
            process.env.PATH ??
            ''
        ).split(platform === 'win32' ? ';' : ':')) {
            if (
                await anyExecutable(
                    names.map((name) =>
                        paths.join(directory.replace(/^"|"$/g, '') || cwd, name)
                    )
                )
            ) {
                return true;
            }
        }
        return false;
    }
    try {
        return await Promise.race([probe().catch(() => null), limit]);
    } finally {
        expired = true;
        clearTimeout(timer);
    }
}
