import { signal } from '@angular/core';

/**
 * How long the mouse must rest in the edge hot zone before the panel slides
 * in. A cursor sweeping across the left edge on its way somewhere else must
 * not flip the panel open and shut.
 */
export const CHANNEL_PANEL_OPEN_DWELL_MS = 160;

/**
 * Grace period after the mouse leaves the panel before it closes. Brushing
 * past the panel's edge while scrolling the list must not slam it shut.
 */
export const CHANNEL_PANEL_CLOSE_GRACE_MS = 420;

/**
 * Framework-light owner of the fullscreen channel panel's open/closed state
 * and the hover-intent timers around it. The component binds pointer events
 * to these methods; the timers here are the only place that decides when a
 * hover becomes an open or a close.
 */
export class FullscreenChannelPanelState {
    readonly open = signal(false);
    /**
     * True from the first open until fullscreen ends. The host template stays
     * mounted while the panel is merely closed so the list keeps its scroll
     * position and search text between two openings of the same session.
     */
    readonly mounted = signal(false);

    private openTimer: number | null = null;
    private closeTimer: number | null = null;

    show(): void {
        this.clearTimers();
        this.mounted.set(true);
        this.open.set(true);
    }

    hide(): void {
        this.clearTimers();
        this.open.set(false);
    }

    toggle(): void {
        if (this.open()) {
            this.hide();
        } else {
            this.show();
        }
    }

    /** Mouse entered the edge hot zone: open once it has rested there. */
    hotZoneEnter(): void {
        if (this.open()) {
            return;
        }
        this.clearOpenTimer();
        this.openTimer = window.setTimeout(() => {
            this.openTimer = null;
            this.show();
        }, CHANNEL_PANEL_OPEN_DWELL_MS);
    }

    hotZoneLeave(): void {
        this.clearOpenTimer();
    }

    /** Mouse is over the panel: a pending close no longer applies. */
    panelEnter(): void {
        this.clearCloseTimer();
    }

    /** Mouse left the panel: close after the grace period. */
    panelLeave(): void {
        if (!this.open()) {
            return;
        }
        this.clearCloseTimer();
        this.closeTimer = window.setTimeout(() => {
            this.closeTimer = null;
            this.open.set(false);
        }, CHANNEL_PANEL_CLOSE_GRACE_MS);
    }

    /** Fullscreen ended: forget everything, including the mounted list. */
    reset(): void {
        this.clearTimers();
        this.open.set(false);
        this.mounted.set(false);
    }

    dispose(): void {
        this.clearTimers();
    }

    private clearTimers(): void {
        this.clearOpenTimer();
        this.clearCloseTimer();
    }

    private clearOpenTimer(): void {
        if (this.openTimer !== null) {
            window.clearTimeout(this.openTimer);
            this.openTimer = null;
        }
    }

    private clearCloseTimer(): void {
        if (this.closeTimer !== null) {
            window.clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
    }
}
