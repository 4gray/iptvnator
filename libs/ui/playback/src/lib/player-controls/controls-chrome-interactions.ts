import { signal } from '@angular/core';
import type { ControlsSurface } from './controls-surface';
import type { ControlsVisibility } from './controls-visibility';

export interface ControlsChromeInteractionsConfig {
    surface: ControlsSurface;
    visibility: ControlsVisibility;
    reveal: (options?: { scheduleHide?: boolean }) => void;
}

/**
 * Pointer/focus state machine of the controls chrome.
 *
 * It answers one question for the auto-hide logic — "is the user currently
 * working the controls?" — and distinguishes pointer activity (reveals, never
 * pins) from keyboard ownership (pins them open until focus leaves).
 *
 * Every chrome region binds to one shared instance (the bottom bar and the
 * top-right corner today): the pin belongs to the interaction, not to a DOM
 * region, so moving the pointer from the corner into the bar must not let the
 * controls hide mid-journey. {@link onFocusOut} stays per-region on purpose —
 * its `currentTarget.contains()` check asks whether focus left *that* region,
 * and a focus move between regions re-arms the hide timer before the arriving
 * region pins it again.
 */
export class ControlsChromeInteractions {
    readonly hovered = signal(false);
    readonly focused = signal(false);

    constructor(private readonly config: ControlsChromeInteractionsConfig) {}

    /** True while the controls must stay on screen for the user's sake. */
    get engaged(): boolean {
        return this.hovered() || this.focused();
    }

    onPointerEnter(): void {
        this.hovered.set(true);
        this.config.reveal({ scheduleHide: false });
    }

    onPointerLeave(): void {
        this.hovered.set(false);
        this.config.visibility.scheduleHide();
    }

    /**
     * A pointer press anywhere in the chrome hands the interaction over to the
     * pointer: a keyboard pin set by an earlier Tab is released here, because
     * the press may not produce any focus event at all (clicking the control
     * that is already focused) or only a focus transfer inside the bar, which
     * {@link onFocusOut} deliberately ignores.
     */
    onPointerDown(): void {
        this.focused.set(false);
    }

    /**
     * A key press that bubbles out of a control inside the chrome means the
     * keyboard is operating that control (Space/Enter on a button, arrows on
     * a slider): the bar is pinned exactly as if the control had been focused
     * with Tab. A completed pointer click no longer leaves its control
     * focused ({@link onClick}), but a press released off the control does,
     * without a pin, and the key press then produces no new focus event, so
     * this is the only place that hands ownership back to the keyboard.
     */
    onKeyDown(): void {
        this.focused.set(true);
        this.config.reveal({ scheduleHide: false });
    }

    /**
     * A pointer click leaves the clicked control focused ({@link onFocusIn}),
     * and a focused control captures the keyboard: Space and Enter activate
     * it again instead of toggling playback, and the playback shortcuts
     * yield to any interactive element in the key's path — after a click on
     * the fullscreen button, Space left fullscreen instead of pausing. The
     * focus was never the keyboard's, so it is released once the click
     * completes; keyboard activation (an empty click `pointerType`) keeps
     * focus where Tab put it.
     */
    onClick(event: MouseEvent): void {
        const bar = event.currentTarget;
        if (
            bar instanceof HTMLElement &&
            this.config.surface.wasPointerClick(event)
        ) {
            this.config.surface.releasePointerFocus(bar);
        }
    }

    onFocusIn(event: FocusEvent): void {
        // Chromium moves focus to a clicked <button>. That focus is a side
        // effect of the click, not keyboard navigation: it must reveal like
        // any pointer activity, but never pin the bar open; `onClick` drops it
        // again once the click completes (issue: fullscreen button left the
        // controls on screen until a click-to-pause on the viewport).
        if (this.config.surface.wasPointerInteraction(event)) {
            this.focused.set(false);
            this.config.reveal();
            return;
        }
        this.focused.set(true);
        this.config.reveal({ scheduleHide: false });
    }

    onFocusOut(event: FocusEvent): void {
        const bar = event.currentTarget as HTMLElement | null;
        const next = event.relatedTarget;
        if (bar && next instanceof Node && bar.contains(next)) {
            return;
        }
        this.focused.set(false);
        this.config.visibility.scheduleHide();
    }
}
