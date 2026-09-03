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
 * The pending record is the LATEST target plus the number of requests
 * whose transition events are still owed, so a burst of presses is settled
 * against the final intent rather than whichever older request happens to
 * report first: an event landing on the target only clears the record once
 * every request has reported, an event landing on the other state
 * re-issues the target (the platform may have dropped a queued request),
 * and a record older than the transition timeout is ignored outright,
 * since no native transition takes that long — requests that produced no
 * event at all are then simply forgotten.
 */
interface PendingFullScreenTransition {
    target: boolean;
    requestedAt: number;
    /** Requests issued whose transition event has not arrived yet. */
    outstanding: number;
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

function getFreshPending(
    state: TrackedFullScreenState,
    now: number
): PendingFullScreenTransition | undefined {
    const pending = state.pending;

    if (!pending) {
        return undefined;
    }

    if (now - pending.requestedAt > FULLSCREEN_TRANSITION_TIMEOUT_MS) {
        state.pending = undefined;
        return undefined;
    }

    return pending;
}

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

        // Through the expiry check so an event arriving after the timeout
        // cannot revive a request the user has long moved past.
        const pending = getFreshPending(state, Date.now());
        if (!pending || win.isDestroyed()) {
            return;
        }

        pending.outstanding = Math.max(0, pending.outstanding - 1);

        if (landed !== pending.target) {
            // An earlier request landed, not the latest one. Ask again
            // rather than trusting the platform to have queued it: a second
            // identical request is a no-op at worst.
            requestFullScreen(win, pending.target);
            return;
        }

        if (pending.outstanding === 0) {
            state.pending = undefined;
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
    return state ? getFreshPending(state, now)?.target : undefined;
}

export function requestFullScreen(
    win: Electron.BrowserWindow,
    target: boolean,
    now: number = Date.now()
): void {
    const state = trackNativeFullScreen(win);
    const pending = getFreshPending(state, now);

    state.pending = {
        target,
        requestedAt: now,
        outstanding: (pending?.outstanding ?? 0) + 1,
    };
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
