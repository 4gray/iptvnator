import { signal } from '@angular/core';

/**
 * Container width (px) below which the controls switch to the compact
 * layout: smaller buttons, volume behind a popover, secondary actions
 * folded away. Mirrors the `@container player-controls (max-width: 719px)`
 * query in the stylesheet, which owns the purely visual sizing; the signal
 * exists for the template branches CSS cannot express (which elements are
 * rendered at all).
 */
export const COMPACT_LAYOUT_MAX_WIDTH = 719;

export type ControlsLayoutMode = 'compact' | 'wide';

/**
 * Observes the controls host's own width and reports the layout mode. The
 * host fills the player box (`inset: 0`), so its width is the player's width
 * — a small inline player inside a wide desktop window is compact, a
 * fullscreen phone is compact, and a windowed desktop player is wide.
 *
 * Without `ResizeObserver` (unit tests, very old runtimes) the mode stays
 * `wide`, which renders every control and is the safe default.
 */
export class ControlsLayout {
    readonly mode = signal<ControlsLayoutMode>('wide');
    private observer: ResizeObserver | null = null;

    attach(host: HTMLElement): void {
        this.detach();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        this.observer = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) {
                return;
            }
            const width =
                entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
            this.applyWidth(width);
        });
        this.observer.observe(host);
        this.applyWidth(host.getBoundingClientRect().width);
    }

    /** Exposed for hosts and tests that already know the width. */
    applyWidth(width: number): void {
        if (!Number.isFinite(width) || width <= 0) {
            return;
        }
        const next: ControlsLayoutMode =
            width <= COMPACT_LAYOUT_MAX_WIDTH ? 'compact' : 'wide';
        if (this.mode() !== next) {
            this.mode.set(next);
        }
    }

    detach(): void {
        this.observer?.disconnect();
        this.observer = null;
    }

    dispose(): void {
        this.detach();
    }
}
