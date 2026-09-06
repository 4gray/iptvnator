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
    /**
     * Scroll position the next animation frame will apply. Rapid wheel/pinch
     * events arrive faster than frames, so the DOM `scrollLeft` still reflects
     * the previous scale by the time the next event computes its anchor; the
     * logical position keeps every event anchored on the same minute.
     */
    private pendingScrollLeft: number | null = null;
    private frame = 0;

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
        this.ctx.setScale(next);
        if (!scroller) {
            return;
        }
        const anchorPx = scroller.clientWidth * anchorFrac;
        const currentLeft = this.pendingScrollLeft ?? scroller.scrollLeft;
        const anchorMin = (currentLeft + anchorPx) / prev;
        this.pendingScrollLeft = anchorMin * next - anchorPx;
        if (this.frame === 0) {
            this.frame = requestAnimationFrame(() => this.flushScroll());
        }
    }

    /** One frame applies the last coalesced position for a burst of events. */
    private flushScroll(): void {
        this.frame = 0;
        const left = this.pendingScrollLeft;
        this.pendingScrollLeft = null;
        const scroller = this.ctx.ribbon();
        if (scroller && left !== null) {
            scroller.scrollLeft = left;
        }
    }
}
