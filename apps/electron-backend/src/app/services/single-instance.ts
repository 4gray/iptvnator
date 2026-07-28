/**
 * Single-instance guard.
 *
 * Every Electron instance that shares a `userData` directory also shares the
 * Chromium storage profile behind it. Only the first process gets the
 * IndexedDB LevelDB lock, so a second concurrent instance silently loses
 * renderer-side persistence: the settings store falls back to defaults on read
 * and its writes never reach disk (issues #102, #1156). Holding a single
 * instance lock is the fix — a second launch focuses the window that already
 * owns the profile instead of opening a broken twin.
 *
 * The lock is scoped to `userData`, so it must be requested *after*
 * `app.setPath('userData', ...)`; otherwise E2E runs with a dedicated data
 * directory would contend on the default profile's lock instead of their own.
 */

/** Minimal Electron `App` surface used by the guard, kept narrow for tests. */
export interface SingleInstanceApp {
    quit(): void;
    on(
        event: 'second-instance',
        listener: (
            event: unknown,
            argv: string[],
            workingDirectory: string
        ) => void
    ): unknown;
    requestSingleInstanceLock(): boolean;
}

/** Minimal `BrowserWindow` surface used when re-focusing the existing window. */
export interface SingleInstanceWindow {
    focus(): void;
    isDestroyed(): boolean;
    isMinimized(): boolean;
    isVisible(): boolean;
    restore(): void;
    show(): void;
}

export const ALLOW_MULTIPLE_INSTANCES_ENV = 'IPTVNATOR_ALLOW_MULTIPLE_INSTANCES';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

/**
 * Escape hatch for local debugging (e.g. attaching a second CDP-enabled
 * instance to the same database). Off by default so packaged users always get
 * the guard.
 */
export function allowsMultipleInstances(
    env: NodeJS.ProcessEnv = process.env
): boolean {
    return TRUTHY_VALUES.has(
        (env[ALLOW_MULTIPLE_INSTANCES_ENV] ?? '').trim().toLowerCase()
    );
}

/** Brings an existing main window back to the foreground. */
export function focusExistingWindow(
    window: SingleInstanceWindow | null | undefined
): void {
    if (!window || window.isDestroyed()) {
        return;
    }

    if (window.isMinimized()) {
        window.restore();
    }

    if (!window.isVisible()) {
        window.show();
    }

    window.focus();
}

/** True when there is no live window left to bring forward. */
function needsNewWindow(
    window: SingleInstanceWindow | null | undefined
): boolean {
    return !window || window.isDestroyed();
}

export interface SingleInstanceOptions {
    env?: NodeJS.ProcessEnv;
    /**
     * Receives the second launch's command line before its window is focused.
     * Electron discards that argv otherwise, and it is the only place a
     * "open this playlist in the running app" request can come from on
     * Windows/Linux. `workingDirectory` belongs to the *other* process, so a
     * relative path must be resolved against it rather than against `cwd()`.
     */
    onSecondInstance?: (argv: string[], workingDirectory: string) => void;
}

/**
 * Acquires the single instance lock.
 *
 * @param createMainWindow re-creates the main window when the lock owner has
 * none left. On macOS closing the last window keeps the process alive, so
 * without this a second launch would quit silently and leave the user with no
 * window at all.
 * @returns `true` when this process owns the profile and startup may continue,
 * `false` when another instance already owns it and this one is quitting.
 */
export function acquireSingleInstanceLock(
    app: SingleInstanceApp,
    getMainWindow: () => SingleInstanceWindow | null | undefined,
    createMainWindow: () => void,
    options: SingleInstanceOptions = {}
): boolean {
    if (allowsMultipleInstances(options.env ?? process.env)) {
        return true;
    }

    if (!app.requestSingleInstanceLock()) {
        app.quit();
        return false;
    }

    app.on('second-instance', (_event, argv, workingDirectory) => {
        options.onSecondInstance?.(argv ?? [], workingDirectory ?? '');

        const mainWindow = getMainWindow();

        if (needsNewWindow(mainWindow)) {
            createMainWindow();
            return;
        }

        focusExistingWindow(mainWindow);
    });

    return true;
}
