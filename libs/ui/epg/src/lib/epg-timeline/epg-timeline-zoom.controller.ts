import {
    nextTimelineZoomScale,
    TIMELINE_WHEEL_ZOOM_RATE,
    TIMELINE_ZOOM_MAX,
    TIMELINE_ZOOM_MIN,
} from './epg-timeline-render.util';

export interface TimelineZoomContext {
    /** The horizontal scroller hosting the track (undefined until rendered). */
    readonly ribbon: () => HTMLElement | undefined;
    readonly scale: () => number;
    readonly setScale: (scale: number) => void;
}

/**
 * Ribbon zoom (px per minute) owned by the toolbar button and the
 * Ctrl/⌘ + wheel gesture. Every change keeps one ribbon minute anchored on
 * screen: the viewport centre for button/programmatic zooms, the cursor for
 * wheel zooms.
 */
export class TimelineZoomController {
    constructor(private readonly ctx: TimelineZoomContext) {}

    /** Clamp + apply a scale, keeping the viewport centre stable. */
    zoomTo(value: number): void {
        this.applyScale(value, 0.5);
    }

    /** Toolbar zoom button: step to the next preset (day → hours → detail). */
    cycle(): void {
        this.applyScale(nextTimelineZoomScale(this.ctx.scale()), 0.5);
    }

    /**
     * Ctrl/⌘ + wheel (and trackpad pinch, which Chromium reports the same
     * way) zooms around the cursor. Plain wheel keeps scrolling.
     * `preventDefault` also stops Chromium's page zoom for the same gesture.
     */
    onWheel(event: WheelEvent): void {
        if (!event.ctrlKey && !event.metaKey) {
            return;
        }
        event.preventDefault();
        const scroller = this.ctx.ribbon();
        const anchor = scroller
            ? (event.clientX - scroller.getBoundingClientRect().left) /
              scroller.clientWidth
            : 0.5;
        const factor = Math.exp(-event.deltaY * TIMELINE_WHEEL_ZOOM_RATE);
        this.applyScale(this.ctx.scale() * factor, anchor);
    }

    /**
     * Set the scale so the ribbon minute under `anchorFrac` (0 = left edge,
     * 1 = right edge of the viewport) stays put.
     */
    private applyScale(value: number, anchorFrac: number): void {
        const requested = Number(value);
        const prev = this.ctx.scale();
        const next = Number.isFinite(requested)
            ? Math.min(
                  TIMELINE_ZOOM_MAX,
                  Math.max(TIMELINE_ZOOM_MIN, requested)
              )
            : prev;
        if (next === prev) {
            return;
        }
        const scroller = this.ctx.ribbon();
        const anchorPx = scroller ? scroller.clientWidth * anchorFrac : 0;
        const anchorMin = scroller
            ? (scroller.scrollLeft + anchorPx) / prev
            : null;
        this.ctx.setScale(next);
        if (scroller && anchorMin !== null) {
            requestAnimationFrame(() => {
                scroller.scrollLeft = anchorMin * next - anchorPx;
            });
        }
    }
}
