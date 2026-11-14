import { signal, Signal } from '@angular/core';

const DEFAULT_IDLE_DELAY_MS = 3000;

/**
 * Tracks whether the inline player's overlay controls (title, copy-URL,
 * close) should be shown: visible on pointer activity over the viewport,
 * hidden again after a period of inactivity, mirroring standard
 * video-player control UX. Kept as a plain class, not a directive, so the
 * idle timing is unit-testable with fake timers alone.
 */
export class IdleControlsVisibility {
    private readonly visibleSignal = signal(true);
    private timeoutId: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly idleDelayMs = DEFAULT_IDLE_DELAY_MS) {
        this.scheduleHide();
    }

    readonly visible: Signal<boolean> = this.visibleSignal.asReadonly();

    /** Call on pointer move/enter over the player viewport. */
    notifyActivity(): void {
        this.visibleSignal.set(true);
        this.scheduleHide();
    }

    /** Clears the pending timer; call from the component's ngOnDestroy. */
    dispose(): void {
        this.clearTimer();
    }

    private scheduleHide(): void {
        this.clearTimer();
        this.timeoutId = setTimeout(() => {
            this.visibleSignal.set(false);
        }, this.idleDelayMs);
    }

    private clearTimer(): void {
        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }
}
