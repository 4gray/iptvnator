import { traceStartupPhase } from '../services/debug-trace';

/**
 * Update process.env.PATH from the user's interactive login shell so that
 * spawned external players (MPV/VLC) can be resolved by binary name when the
 * app was started from Finder or a desktop launcher.
 *
 * The shell (`$SHELL -ilc env`) starts asynchronously. Its start-up cost
 * depends on the user's shell profile and was about 1-2 s with a typical
 * zsh setup; the synchronous `fix-path` used before blocked the main thread
 * for all of it, right when the database worker's `ready` message and the
 * renderer's first IPC calls were waiting, which delayed the first card of
 * the launch journey by the same amount. The resulting PATH, and the
 * fallback when the shell reports none, are the ones `fix-path` 5 produced.
 *
 * Runs after window creation and IPC handler registration. Idempotent:
 * subsequent calls are no-ops. shell-path is imported here, on demand, so
 * its module evaluation stays off the launch path as well.
 */
let loginShellPathScheduled = false;

export type ReadLoginShellPath = () => Promise<string | undefined>;

const readLoginShellPath: ReadLoginShellPath = async () => {
    const { shellPath } = await import('shell-path');
    return shellPath();
};

export async function hydratePathFromLoginShell(
    readPath: ReadLoginShellPath = readLoginShellPath
): Promise<void> {
    const shellPath = await readPath();
    process.env.PATH =
        shellPath ||
        [
            './node_modules/.bin',
            '/.nodebrew/current/bin',
            '/usr/local/bin',
            process.env.PATH,
        ].join(':');
}

export function scheduleDeferredFixPath(
    readPath: ReadLoginShellPath = readLoginShellPath
): void {
    if (loginShellPathScheduled || process.platform === 'win32') {
        return;
    }

    loginShellPathScheduled = true;
    setImmediate(() => {
        hydratePathFromLoginShell(readPath)
            .then(() => {
                traceStartupPhase('fix-path:done');
            })
            .catch((error) => {
                console.warn('Login shell PATH lookup failed:', error);
            });
    });
}
