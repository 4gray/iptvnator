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
 *
 * Handlers that spawn a binary by bare name (external players, the Linux
 * `mpv --version` check of embedded MPV) await `waitForLoginShellPath()`
 * first, so they see the same PATH the blocking lookup guaranteed.
 */
let loginShellPathScheduled = false;
let settleLoginShellPath: () => void = () => undefined;
const loginShellPathSettled: Promise<void> =
    process.platform === 'win32'
        ? Promise.resolve()
        : new Promise((resolve) => {
              settleLoginShellPath = resolve;
          });

/**
 * Time budget of the lookup, counted from its start. A shell that has not
 * answered by then is treated as hung: waits end at this shared deadline,
 * so a broken profile cannot delay every launch by the full budget, while a
 * launch retried within the budget still waits for the PATH.
 */
export const LOGIN_SHELL_PATH_WAIT_LIMIT_MS = 10_000;
let loginShellPathDeadline: number | null = null;

let loginShellPathHasSettled = process.platform === 'win32';
const settledOutcome = loginShellPathSettled.then(() => {
    loginShellPathHasSettled = true;
    return true;
});

/**
 * Resolves once the login shell PATH lookup has finished (successfully or
 * not), or when its budget is spent; immediately on Windows. Before the
 * lookup is scheduled, waits end at a deadline shared from the first of
 * them. `limitMs` caps a single wait. Resolves to whether
 * the lookup had finished: false means the caller runs on the inherited
 * PATH and should not keep a negative result.
 */
export function waitForLoginShellPath(
    limitMs = LOGIN_SHELL_PATH_WAIT_LIMIT_MS
): Promise<boolean> {
    if (loginShellPathHasSettled) {
        return Promise.resolve(true);
    }
    // Waits before the lookup is scheduled share one deadline too, set by
    // the first of them; scheduling the lookup replaces it with its budget.
    loginShellPathDeadline ??= Date.now() + LOGIN_SHELL_PATH_WAIT_LIMIT_MS;
    const remainingMs = Math.min(limitMs, loginShellPathDeadline - Date.now());
    if (remainingMs <= 0) {
        return Promise.resolve(false);
    }
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), remainingMs);
    });
    return Promise.race([settledOutcome, limit]).finally(() =>
        clearTimeout(timer)
    );
}

/** Resolves when the lookup finishes, however long it takes. */
export function whenLoginShellPathSettled(): Promise<void> {
    return loginShellPathSettled;
}

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
    readPath: ReadLoginShellPath = readLoginShellPath,
    budgetMs = LOGIN_SHELL_PATH_WAIT_LIMIT_MS
): void {
    if (loginShellPathScheduled || process.platform === 'win32') {
        return;
    }

    loginShellPathScheduled = true;
    loginShellPathDeadline = Date.now() + budgetMs;
    setImmediate(() => {
        hydratePathFromLoginShell(readPath)
            .then(() => {
                traceStartupPhase('fix-path:done');
            })
            .catch((error) => {
                console.warn('Login shell PATH lookup failed:', error);
            })
            .finally(() => settleLoginShellPath());
    });
}
