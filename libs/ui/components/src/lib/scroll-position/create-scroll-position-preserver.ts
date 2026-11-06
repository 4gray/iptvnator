import { DestroyRef } from '@angular/core';

/** Stops a reveal without letting Chromium's pending compositor frame move it. */
export function createScrollPositionPreserver(destroyRef: DestroyRef): {
    cancel: () => void;
    preserve: (container: HTMLElement) => void;
} {
    let frame: number | undefined;
    const cancel = () => {
        if (frame !== undefined) {
            cancelAnimationFrame(frame);
            frame = undefined;
        }
    };
    destroyRef.onDestroy(cancel);

    return {
        cancel,
        preserve(container) {
            cancel();
            const top = container.scrollTop;
            const restore = () =>
                container.scrollTo?.({ behavior: 'instant', top });
            restore();
            // Aborting a smooth scroll can still commit one compositor update.
            // Reassert the position once that update has reached the main thread.
            frame = requestAnimationFrame(() => {
                frame = undefined;
                restore();
            });
        },
    };
}
