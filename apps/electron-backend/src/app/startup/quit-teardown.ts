/**
 * Runs the async teardown on `will-quit` before the process is allowed to
 * exit.
 *
 * 'will-quit', not 'before-quit': the unsaved-settings close guard can
 * cancel a quit mid-flight by preventing the window close, and 'before-quit'
 * has already fired by then — tearing sessions and the DB worker down there
 * would leave a cancelled quit with the app open but playback and database
 * work destroyed. 'will-quit' only fires once every window close was allowed
 * through, including the windows `quitAndInstall()` closes for an update.
 *
 * The first `will-quit` is held while the teardown drains the database
 * worker (writes sent just before quitting, and the renderer's `pagehide`
 * flush), then the quit is resumed. The windows are already closed, so the
 * resumed quit goes straight through. `QUIT_TEARDOWN_TIMEOUT_MS` caps the
 * wait even if a teardown never settles.
 */

/** Outer cap; the worker client's own budgets normally end sooner. */
export const QUIT_TEARDOWN_TIMEOUT_MS = 4000;

type QuitEvent = { preventDefault(): void };

export interface QuitTeardownApp {
    on(event: 'will-quit', listener: (event: QuitEvent) => void): unknown;
    quit(): void;
}

export interface QuitTeardownHooks {
    /** Synchronous work that must run on every quit. */
    readonly stopNow: () => void;
    /** Async teardown; `null` when there is nothing to wait for. */
    readonly drain: () => Promise<void> | null;
    readonly timeoutMs?: number;
}

export function registerQuitTeardown(
    app: QuitTeardownApp,
    hooks: QuitTeardownHooks
): void {
    let state: 'idle' | 'draining' | 'done' = 'idle';

    app.on('will-quit', (event) => {
        if (state === 'done') {
            return;
        }
        if (state === 'draining') {
            event.preventDefault();
            return;
        }

        hooks.stopNow();
        const drain = hooks.drain();
        if (!drain) {
            state = 'done';
            return;
        }

        state = 'draining';
        event.preventDefault();
        void settleWithin(
            drain,
            hooks.timeoutMs ?? QUIT_TEARDOWN_TIMEOUT_MS
        ).then(() => {
            state = 'done';
            app.quit();
        });
    });
}

async function settleWithin(
    work: Promise<void>,
    timeoutMs: number
): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
    });
    try {
        await Promise.race([work.catch(() => undefined), timeout]);
    } finally {
        clearTimeout(timer);
    }
}
