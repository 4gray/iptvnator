/**
 * Native fullscreen state and in-flight transitions, per window.
 *
 * `BrowserWindow.isFullScreen()` cannot drive a toggle: setFullScreen()
 * completes asynchronously (the macOS animation, Linux window managers),
 * and on Windows the getter can still report the pre-transition value even
 * while the matching event fires (see attachWindowStateEvents). A toggle
 * decided against the getter would request the same target twice — two
 * quick F11 presses would land fullscreen instead of returning to the
 * window, and F11 during the startup fullscreen animation would ask for
 * fullscreen again instead of leaving it.
 *
 * So the tracker keeps its own notion of the window's fullscreen state: it
 * is seeded once from the getter when tracking starts — at window creation,
 * while no transition is in flight — and afterwards fed only by the
 * `enter-full-screen` / `leave-full-screen` events, which also cover
 * transitions the app did not request (macOS green button, Ctrl+Cmd+F,
 * HTML fullscreen on Windows). Every native fullscreen request goes through
 * `requestFullScreen`, and a toggle is decided against the pending target
 * if one is in flight, else against that tracked state — never the getter.
 *
 * A pending target can never govern a toggle for good: it is dropped when
 * the transition event reports it, a transition landing on the OTHER state
 * re-issues it (the queued request may have been dropped by the platform),
 * and an entry older than the transition timeout is ignored outright, since
 * no native transition takes that long — a request that produced no event
 * at all is then simply forgotten.
 */
interface PendingFullScreenTransition {
    target: boolean;
    requestedAt: number;
}

interface TrackedFullScreenState {
    /** Event-fed fullscreen state; seeded from the getter once. */
    fullScreen: boolean;
    pending?: PendingFullScreenTransition;
}

/** Longest a native transition is trusted to still be in flight. */
export const FULLSCREEN_TRANSITION_TIMEOUT_MS = 2000;

const trackedWindows = new WeakMap<
    Electron.BrowserWindow,
    TrackedFullScreenState
>();

/**
 * Starts following the window's native fullscreen events. Call it right
 * after the window is created, when no transition can be in flight, so the
 * seed read is the one time the getter is trusted; later callers get the
 * existing record.
 */
export function trackNativeFullScreen(
    win: Electron.BrowserWindow
): TrackedFullScreenState {
    const existing = trackedWindows.get(win);
    if (existing) {
        return existing;
    }

    const state: TrackedFullScreenState = { fullScreen: win.isFullScreen() };
    trackedWindows.set(win, state);

    // `landed` is the state the event itself conveys, never a re-read of
    // the getter.
    const settle = (landed: boolean) => {
        state.fullScreen = landed;

        // Through the getter so an expired target is dropped here too: an
        // event arriving after the timeout belongs to a request the user
        // has long moved past, and re-issuing it would revive the stale
        // intent with a fresh timestamp.
        const pendingTarget = getPendingFullScreenTarget(win);
        state.pending = undefined;
        if (pendingTarget === undefined || win.isDestroyed()) {
            return;
        }

        if (landed !== pendingTarget) {
            // An earlier transition landed, not the requested one. Ask
            // again rather than trusting the platform to have queued it: a
            // second identical request is a no-op at worst.
            requestFullScreen(win, pendingTarget);
        }
    };
    win.on('enter-full-screen', () => settle(true));
    win.on('leave-full-screen', () => settle(false));

    return state;
}

export function getPendingFullScreenTarget(
    win: Electron.BrowserWindow,
    now: number = Date.now()
): boolean | undefined {
    const state = trackedWindows.get(win);
    const pending = state?.pending;

    if (!state || !pending) {
        return undefined;
    }

    if (now - pending.requestedAt > FULLSCREEN_TRANSITION_TIMEOUT_MS) {
        state.pending = undefined;
        return undefined;
    }

    return pending.target;
}

export function requestFullScreen(
    win: Electron.BrowserWindow,
    target: boolean,
    now: number = Date.now()
): void {
    const state = trackNativeFullScreen(win);
    state.pending = { target, requestedAt: now };
    win.setFullScreen(target);
}

/**
 * Requests the opposite of the pending target, or of the tracked state when
 * no transition is in flight, and returns the requested state.
 */
export function toggleFullScreen(
    win: Electron.BrowserWindow,
    now: number = Date.now()
): boolean {
    const state = trackNativeFullScreen(win);
    const target = !(getPendingFullScreenTarget(win, now) ?? state.fullScreen);
    requestFullScreen(win, target, now);
    return target;
}
