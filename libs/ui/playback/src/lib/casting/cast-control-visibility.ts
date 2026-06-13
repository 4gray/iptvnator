import { signal } from '@angular/core';

const CAST_CONTROL_HIDE_DELAY_MS = 2500;

export class CastControlVisibility {
    readonly visible = signal(true);

    private hideTimer: ReturnType<typeof setTimeout> | null = null;
    private interactionActive = false;
    private menuOpen = false;

    showTemporarily(): void {
        this.visible.set(true);
        this.scheduleHide();
    }

    setInteractionActive(active: boolean): void {
        this.interactionActive = active;
        this.visible.set(true);

        if (active) {
            this.clearHideTimer();
            return;
        }

        this.scheduleHide();
    }

    handleFocusOut(event: FocusEvent): void {
        const container = event.currentTarget as HTMLElement | null;
        const nextTarget = event.relatedTarget;

        if (nextTarget instanceof Node && container?.contains(nextTarget)) {
            return;
        }

        this.setInteractionActive(false);
    }

    setMenuOpen(open: boolean): void {
        this.menuOpen = open;
        this.visible.set(true);

        if (open) {
            this.clearHideTimer();
            return;
        }

        this.scheduleHide();
    }

    destroy(): void {
        this.clearHideTimer();
    }

    private scheduleHide(): void {
        this.clearHideTimer();

        if (this.interactionActive || this.menuOpen) {
            return;
        }

        this.hideTimer = setTimeout(() => {
            this.visible.set(false);
            this.hideTimer = null;
        }, CAST_CONTROL_HIDE_DELAY_MS);
    }

    private clearHideTimer(): void {
        if (this.hideTimer === null) {
            return;
        }

        clearTimeout(this.hideTimer);
        this.hideTimer = null;
    }
}
