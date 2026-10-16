import { signal } from '@angular/core';

/**
 * How long the mouse must rest in the edge hot zone before the panel slides
 * in. A cursor sweeping across the left edge on its way somewhere else must
 * not flip the panel open and shut.
 */
export const CHANNEL_PANEL_OPEN_DWELL_MS = 160;

/**
 * Grace period after the mouse leaves the panel before it closes. Brushing
 * past the panel's edge while scrolling the list, or reaching for the video
 * to glance at it, must not slam the panel shut.
 */
export const CHANNEL_PANEL_CLOSE_GRACE_MS = 1000;

/**
 * How long the edge hint stays visible after the last pointer movement over
 * the stage. Roughly the controls bar's own auto-hide, so the hint comes and
 * goes with the rest of the player chrome.
 */
export const CHANNEL_PANEL_HINT_IDLE_MS = 2500;

/** What brought the panel up; decides whether hover-away may close it. */
export type ChannelPanelOpener = 'pointer' | 'keyboard';

/**
 * Framework-light owner of the fullscreen channel panel's open/closed state
 * and the hover-intent timers around it. The component binds pointer events
 * to these methods; the timers here are the only place that decides when a
 * hover becomes an open or a close.
 *
 * Hover-away closes the panel only once the pointer has engaged with it: a
 * hover-opened panel counts as engaged from the start (the pointer is on the
 * edge), while a keyboard-opened one ignores the mouse roaming over the
 * video until it has visited the panel. Otherwise pressing `C` and nudging
 * the mouse would close the list under the user's typing.
 *
 * An explicit close (Escape, close button, `C`) re-arms the hot zone only on
 * the next real pointer movement: when the panel slides out from under a
 * mouse that is still resting on the edge, the browser synthesizes a
 * `pointerenter` on the zone the panel had covered, and honouring it would
 * reopen the list 160ms after the user dismissed it.
 */
export class FullscreenChannelPanelState {
    readonly open = signal(false);
    /**
     * True from the first open until fullscreen ends. The host template stays
     * mounted while the panel is merely closed so the list keeps its scroll
     * position and search text between two openings of the same session.
     */
    readonly mounted = signal(false);
    /**
     * The edge hint is showing: the pointer moved over the stage recently
     * while the panel was closed, so the user is looking for something.
     */
    readonly hintVisible = signal(false);
    /**
     * The pointer is resting in an armed hot zone, waiting out the dwell.
     * Stays false for the synthetic enter that follows an explicit close, so
     * the hint does not light up on an edge that cannot open yet.
     */
    readonly hotZoneHover = signal(false);

    private pointerEngaged = false;
    /** False between an explicit close and the next pointer move. */
    private pointerMovedSinceHide = true;
    /** Where the pointer physically is, armed or not. */
    private pointerInHotZone = false;
    private openTimer: number | null = null;
    private closeTimer: number | null = null;
    private hintTimer: number | null = null;

    show(opener: ChannelPanelOpener = 'pointer'): void {
        this.clearTimers();
        this.pointerEngaged = opener === 'pointer';
        this.hintVisible.set(false);
        this.hotZoneHover.set(false);
        this.mounted.set(true);
        this.open.set(true);
    }

    hide(): void {
        this.clearTimers();
        this.pointerEngaged = false;
        this.pointerMovedSinceHide = false;
        this.open.set(false);
    }

    toggle(opener: ChannelPanelOpener = 'pointer'): void {
        if (this.open()) {
            this.hide();
        } else {
            this.show(opener);
        }
    }

    /** Mouse entered the edge hot zone: open once it has rested there. */
    hotZoneEnter(): void {
        this.pointerInHotZone = true;
        if (this.open() || !this.pointerMovedSinceHide) {
            return;
        }
        this.hotZoneHover.set(true);
        this.startDwell();
    }

    hotZoneLeave(): void {
        this.pointerInHotZone = false;
        this.hotZoneHover.set(false);
        this.clearOpenTimer();
    }

    /** Mouse is over the panel: a pending close no longer applies. */
    panelEnter(): void {
        this.pointerEngaged = true;
        this.clearCloseTimer();
    }

    /** Mouse left the panel: close after the grace period. */
    panelLeave(): void {
        if (!this.open() || !this.pointerEngaged) {
            return;
        }
        this.clearCloseTimer();
        this.closeTimer = window.setTimeout(() => {
            this.closeTimer = null;
            this.open.set(false);
        }, CHANNEL_PANEL_CLOSE_GRACE_MS);
    }

    /**
     * Pointer moved over the stage while the panel is closed: show the edge
     * hint until the pointer goes idle. Nothing is drawn while it rests.
     */
    stageActivity(): void {
        this.pointerMovedSinceHide = true;
        if (this.open()) {
            return;
        }
        this.hintVisible.set(true);
        this.clearHintTimer();
        this.hintTimer = window.setTimeout(() => {
            this.hintTimer = null;
            this.hintVisible.set(false);
        }, CHANNEL_PANEL_HINT_IDLE_MS);
        // The pointer was already resting in the zone when it re-armed: this
        // move arms the hint and starts the dwell.
        if (this.pointerInHotZone && this.openTimer === null) {
            this.hotZoneHover.set(true);
            this.startDwell();
        }
    }

    /** Fullscreen ended: forget everything, including the mounted list. */
    reset(): void {
        this.clearTimers();
        this.pointerEngaged = false;
        this.pointerMovedSinceHide = true;
        this.pointerInHotZone = false;
        this.hintVisible.set(false);
        this.hotZoneHover.set(false);
        this.open.set(false);
        this.mounted.set(false);
    }

    dispose(): void {
        this.clearTimers();
    }

    private startDwell(): void {
        this.clearOpenTimer();
        this.openTimer = window.setTimeout(() => {
            this.openTimer = null;
            this.show('pointer');
        }, CHANNEL_PANEL_OPEN_DWELL_MS);
    }

    private clearTimers(): void {
        this.clearOpenTimer();
        this.clearCloseTimer();
        this.clearHintTimer();
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

    private clearHintTimer(): void {
        if (this.hintTimer !== null) {
            window.clearTimeout(this.hintTimer);
            this.hintTimer = null;
        }
    }
}
