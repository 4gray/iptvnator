/**
 * Native fullscreen transitions still in flight, per window.
 *
 * setFullScreen() completes asynchronously (the macOS animation, Linux
 * window managers) and isFullScreen() keeps reporting the old value
 * meanwhile, so a toggle decided against the getter alone would request the
 * same target twice — two quick F11 presses would land fullscreen instead of
 * returning to the window, and F11 during the startup fullscreen animation
 * would ask for fullscreen again instead of leaving it. Every native
 * fullscreen request therefore goes through this tracker, and the toggle is
 * decided against the pending target.
 *
 * The entry can never govern a toggle for good: it is dropped when a
 * transition event reports the target state, a transition that lands on the
 * OTHER state re-issues the target (the queued request may have been dropped
 * by the platform), and an entry older than the transition timeout is
 * ignored outright, since no native transition takes that long — a request
 * that produced no event at all is then simply forgotten.
 */
interface PendingFullScreenTransition {
    target: boolean;
    requestedAt: number;
}

/** Longest a native transition is trusted to still be in flight. */
export const FULLSCREEN_TRANSITION_TIMEOUT_MS = 2000;

const pendingFullScreenTransitions = new WeakMap<
    Electron.BrowserWindow,
    PendingFullScreenTransition
>();
const windowsWithTransitionListeners = new WeakSet<Electron.BrowserWindow>();

export function getPendingFullScreenTarget(
    win: Electron.BrowserWindow,
    now: number = Date.now()
): boolean | undefined {
    const pending = pendingFullScreenTransitions.get(win);

    if (!pending) {
        return undefined;
    }

    if (now - pending.requestedAt > FULLSCREEN_TRANSITION_TIMEOUT_MS) {
        pendingFullScreenTransitions.delete(win);
        return undefined;
    }

    return pending.target;
}

export function requestFullScreen(
    win: Electron.BrowserWindow,
    target: boolean,
    now: number = Date.now()
): void {
    if (!windowsWithTransitionListeners.has(win)) {
        windowsWithTransitionListeners.add(win);
        const settle = () => {
            const pending = pendingFullScreenTransitions.get(win);
            if (!pending || win.isDestroyed()) {
                return;
            }

            pendingFullScreenTransitions.delete(win);
            if (win.isFullScreen() !== pending.target) {
                // An earlier transition landed, not the requested one. Ask
                // again rather than trusting the platform to have queued
                // it: a second identical request is a no-op at worst.
                requestFullScreen(win, pending.target);
            }
        };
        win.on('enter-full-screen', settle);
        win.on('leave-full-screen', settle);
    }

    pendingFullScreenTransitions.set(win, { target, requestedAt: now });
    win.setFullScreen(target);
}

/**
 * Requests the opposite of the pending target, or of the live state when no
 * transition is in flight, and returns the requested state.
 */
export function toggleFullScreen(
    win: Electron.BrowserWindow,
    now: number = Date.now()
): boolean {
    const target = !(
        getPendingFullScreenTarget(win, now) ?? win.isFullScreen()
    );
    requestFullScreen(win, target, now);
    return target;
}
