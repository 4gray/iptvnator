/**
 * Opens the database at startup and runs the recovery passes for downloads
 * and recordings a previous session left behind.
 *
 * `initDatabase()` forgets a failed attempt, so a transient failure (the
 * file briefly locked by a closing older version, antivirus, a full disk)
 * is retried here a few times before the user is told. The recovery passes
 * run after whichever attempt succeeds. IPC handlers can open the database
 * lazily during a retry delay and start work first, so both passes skip
 * the downloads and recordings this process owns. If every attempt fails
 * the passes are left to the next launch.
 */
export const DATABASE_STARTUP_RETRY_DELAYS_MS: readonly number[] = [
    1_000, 3_000, 10_000,
];

export interface DatabaseStartupDeps {
    readonly initDatabase: () => Promise<unknown>;
    readonly recoveryPasses: readonly (() => Promise<void>)[];
    readonly reportFailure: (error: unknown) => void;
    readonly trace: (phase: string) => void;
    readonly retryDelaysMs?: readonly number[];
    readonly wait?: (ms: number) => Promise<void>;
}

const defaultWait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Never rejects: a failure is reported and the app keeps running. */
export async function openDatabaseAtStartup(
    deps: DatabaseStartupDeps
): Promise<boolean> {
    const delays = deps.retryDelaysMs ?? DATABASE_STARTUP_RETRY_DELAYS_MS;
    const wait = deps.wait ?? defaultWait;
    let lastError: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        if (attempt > 0) {
            deps.trace('init-database:retry');
            await wait(delays[attempt - 1]);
        }
        try {
            await deps.initDatabase();
        } catch (error) {
            lastError = error;
            continue;
        }
        return runRecoveryPasses(deps);
    }
    deps.trace('init-database:failed');
    deps.reportFailure(lastError);
    return false;
}

async function runRecoveryPasses(deps: DatabaseStartupDeps): Promise<true> {
    deps.trace('init-database:done');
    for (const pass of deps.recoveryPasses) {
        try {
            await pass();
        } catch (error) {
            console.error(
                'Startup recovery pass failed:',
                describeStartupError(error)
            );
        }
    }
    return true;
}

/**
 * The SQLite error code and message only: better-sqlite3 messages name no
 * path or statement, but a stack or wrapped cause could carry either.
 */
export function describeStartupError(error: unknown): string {
    if (!(error instanceof Error)) return 'unknown error';
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string'
        ? `${code}: ${error.message}`
        : error.message;
}

export interface StartupFailureDialog {
    readonly type: 'error';
    readonly title: string;
    readonly message: string;
    readonly detail: string;
}

/** Logs the failure without paths or SQL and tells the user, unawaited. */
export function reportDatabaseStartupFailure(
    error: unknown,
    showMessageBox: (options: StartupFailureDialog) => Promise<unknown>
): void {
    console.error(
        'Database could not be opened at startup:',
        describeStartupError(error)
    );
    void showMessageBox({
        type: 'error',
        title: 'Library could not be opened',
        message: 'IPTVnator could not open its library database.',
        detail: 'Sources, favorites and downloads are unavailable for now. Close any other IPTVnator window, check that the disk has free space, then restart IPTVnator.',
    }).catch(() => undefined);
}
