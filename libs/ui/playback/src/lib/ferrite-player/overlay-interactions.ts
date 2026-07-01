// Framework-free pointer wiring for the ferrite overlays — overlay reveal-on-activity + idle fade,
// and a long-press (hold ≥600 ms) that toggles the diagnostic panel. Kept out of the Angular
// component so the DOM/timer plumbing stays testable-shaped and the component stays small.
//
// Separation of concerns (the deliverable's "scope long-press to the surface" requirement):
//   • ACTIVITY (reveal controls) listens on the SHELL — pointer movement anywhere over the player,
//     including over the controls themselves, keeps them visible.
//   • LONG-PRESS (toggle debug) listens on the CANVAS only — so a press on the control bar (e.g.
//     dragging the volume slider) never toggles the debug panel, and it can't clash with
//     iptvnator's own list/touch gestures outside the video surface.

const LONG_PRESS_MS = 600; // long-press hold timer (ms)
const IDLE_HIDE_MS = 3000; // fade the controls after ~3 s idle (deliverable spec)

export interface OverlayInteractionCallbacks {
    /** Pointer activity over the player surface — reveal the controls. */
    onActivity: () => void;
    /** Controls have been idle past the fade timeout — hide them. */
    onIdle: () => void;
    /** A long-press completed on the video surface — toggle the debug panel. */
    onLongPress: () => void;
}

/**
 * Wire reveal-on-activity + idle-fade (on `shell`) and long-press-to-toggle-debug (on `canvas`).
 * Returns a cleanup function that removes every listener and clears both pending timers — call it
 * on canvas re-attach and on component destroy so nothing leaks across channel zaps.
 */
export function wireOverlayInteractions(
    shell: HTMLElement,
    canvas: HTMLElement,
    cb: OverlayInteractionCallbacks
): () => void {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;

    const armIdle = (): void => {
        if (idleTimer !== null) {
            clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
            idleTimer = null;
            cb.onIdle();
        }, IDLE_HIDE_MS);
    };

    const activity = (): void => {
        cb.onActivity();
        armIdle();
    };

    const pressDown = (): void => {
        if (holdTimer !== null) {
            clearTimeout(holdTimer);
        }
        holdTimer = setTimeout(() => {
            holdTimer = null;
            cb.onLongPress();
        }, LONG_PRESS_MS);
    };
    const pressCancel = (): void => {
        if (holdTimer !== null) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
    };

    shell.addEventListener('pointermove', activity);
    shell.addEventListener('pointerdown', activity);
    shell.addEventListener('pointerenter', activity);

    canvas.addEventListener('pointerdown', pressDown);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
        canvas.addEventListener(ev, pressCancel);
    }

    // Start the idle countdown so the controls fade even before the first pointer move.
    armIdle();

    return (): void => {
        if (idleTimer !== null) {
            clearTimeout(idleTimer);
        }
        if (holdTimer !== null) {
            clearTimeout(holdTimer);
        }
        shell.removeEventListener('pointermove', activity);
        shell.removeEventListener('pointerdown', activity);
        shell.removeEventListener('pointerenter', activity);
        canvas.removeEventListener('pointerdown', pressDown);
        for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
            canvas.removeEventListener(ev, pressCancel);
        }
    };
}
