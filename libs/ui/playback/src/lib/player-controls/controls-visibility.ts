import { signal } from '@angular/core';

export const HIDE_CONTROLS_DELAY_MS = 2500;

export interface RevealOptions {
    /** When false, only reveals without (re)scheduling the auto-hide. */
    scheduleHide?: boolean;
}

/**
 * Small framework-light helper that owns the controls reveal/auto-hide
 * lifecycle. The controls become visible on user interaction and auto-hide
 * after a delay, but only when the `canHide` predicate permits it (e.g. only
 * while playing, no menu open, no status text showing).
 */
export class ControlsVisibility {
    readonly visible = signal(true);

    private hideTimer: number | null = null;

    constructor(
        private readonly canHide: () => boolean,
        private readonly delayMs = HIDE_CONTROLS_DELAY_MS
    ) {}

    reveal(options: RevealOptions = {}): void {
        const scheduleHide = options.scheduleHide ?? true;
        this.visible.set(true);
        if (scheduleHide) {
            this.clear();
            this.scheduleHide();
        }
    }

    scheduleHide(): void {
        if (!this.canHide()) {
            this.clear();
            return;
        }
        if (!this.visible() || this.hideTimer !== null) {
            return;
        }
        this.hideTimer = window.setTimeout(() => {
            this.hideTimer = null;
            if (this.canHide()) {
                this.visible.set(false);
            }
        }, this.delayMs);
    }

    clear(): void {
        if (this.hideTimer === null) {
            return;
        }
        window.clearTimeout(this.hideTimer);
        this.hideTimer = null;
    }

    dispose(): void {
        this.clear();
    }
}
