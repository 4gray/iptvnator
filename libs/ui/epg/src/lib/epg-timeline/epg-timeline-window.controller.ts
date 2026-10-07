import {
    computed,
    effect,
    ElementRef,
    inject,
    linkedSignal,
    Signal,
    untracked,
} from '@angular/core';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { getTodayEpgDateKey, parseEpgDateKey } from '../epg-date';
import { programsFocusKey } from './epg-timeline-scroll.controller';
import {
    TIMELINE_MINUTE_MS,
    TimelineAxis,
    TimelineBlock,
    TimelineDayDivider,
    TimelineRenderItem,
    TimelineTick,
} from './epg-timeline.utils';

// ───────────────────────── ribbon windowing ─────────────────────────
// A channel's schedule is often a few hundred programmes over several days,
// but the ribbon shows a few hours. Rendering every block costs thousands of
// DOM nodes the moment a channel is selected, while its stream is starting
// (J3 in docs/architecture/performance-journeys.md). Only blocks, ticks and
// dividers near the visible range are rendered; the track keeps its full
// width, so scrolling, the scrollbar and every position are unchanged.

/** Viewport widths rendered beyond each edge of the visible ribbon. */
export const TIMELINE_WINDOW_BUFFER_VIEWPORTS = 0.5;
/**
 * Scrolling re-windows only once the centre moved this share of a viewport.
 * Below the buffer, so the visible range is always rendered between steps.
 */
export const TIMELINE_WINDOW_STEP_FRACTION = 0.25;
/** Room for a tick or day label that starts left of the window. */
const TIMELINE_LABEL_ALLOWANCE_PX = 160;

/** The centre of the rendered range (epoch ms) and the viewport width it covers. */
export interface TimelineViewport {
    readonly centreMs: number;
    readonly widthPx: number;
}

export interface TimelinePxRange {
    readonly startPx: number;
    readonly endPx: number;
}

export function timelineWindowRange(
    viewport: TimelineViewport,
    axis: TimelineAxis,
    scale: number
): TimelinePxRange {
    const centrePx =
        ((viewport.centreMs - axis.startMs) / TIMELINE_MINUTE_MS) * scale;
    const halfPx = viewport.widthPx * (0.5 + TIMELINE_WINDOW_BUFFER_VIEWPORTS);
    return { startPx: centrePx - halfPx, endPx: centrePx + halfPx };
}

/** Render items overlapping the range, in their original order. */
export function renderItemsInRange(
    items: readonly TimelineRenderItem[],
    range: TimelinePxRange
): TimelineRenderItem[] {
    return items.filter(
        (item) =>
            item.leftPx + item.widthPx >= range.startPx &&
            item.leftPx <= range.endPx
    );
}

/** Ticks or day dividers whose label can reach into the range. */
export function marksInRange<T extends TimelineTick | TimelineDayDivider>(
    marks: readonly T[],
    scale: number,
    range: TimelinePxRange
): T[] {
    return marks.filter((mark) => {
        const leftPx = mark.offsetMin * scale;
        return (
            leftPx >= range.startPx - TIMELINE_LABEL_ALLOWANCE_PX &&
            leftPx <= range.endPx
        );
    });
}

export function viewportFromScroller(
    scrollLeft: number,
    clientWidth: number,
    axis: TimelineAxis,
    scale: number
): TimelineViewport {
    const centreMin = (scrollLeft + clientWidth / 2) / scale;
    return {
        centreMs: axis.startMs + centreMin * TIMELINE_MINUTE_MS,
        widthPx: clientWidth,
    };
}

/**
 * Whether a measured viewport needs a new window: the centre moved far enough
 * or the ribbon got wider than the covered width. A narrower ribbon keeps the
 * (larger) window, so a resize never removes blocks still in view.
 */
export function viewportNeedsWindow(
    current: TimelineViewport,
    next: TimelineViewport,
    scale: number
): boolean {
    if (next.widthPx > current.widthPx) {
        return true;
    }
    const movedPx =
        (Math.abs(next.centreMs - current.centreMs) / TIMELINE_MINUTE_MS) *
        scale;
    return movedPx >= current.widthPx * TIMELINE_WINDOW_STEP_FRACTION;
}

/** The timeline component's signals the controller reads. */
export interface TimelineWindowHost {
    readonly ribbon: Signal<ElementRef<HTMLElement> | undefined>;
    readonly programs: Signal<readonly EpgProgram[]>;
    readonly axis: Signal<TimelineAxis>;
    readonly blocks: Signal<readonly TimelineBlock[]>;
    readonly scale: Signal<number>;
    readonly nowMs: Signal<number>;
    readonly viewDayKey: Signal<string>;
    readonly renderItems: Signal<readonly TimelineRenderItem[]>;
    readonly ticks: Signal<readonly TimelineTick[]>;
    readonly dividers: Signal<readonly TimelineDayDivider[]>;
}

/**
 * Picks the ribbon content to render. Before the ribbon reports a scroll
 * position, the window is centred where the auto-focus lands (the programme
 * on now, or noon of a viewed non-today day) and spans the timeline host's
 * width (the browser window's before the host is laid out), an upper bound
 * of the ribbon's. A new channel or a remounted ribbon starts over from that
 * estimate. Construct it in an injection context (a component field): it
 * reads the host element and observes the ribbon's size.
 */
export class TimelineWindowController {
    private measureFrame = 0;
    private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);

    private readonly identity = computed(
        () => ({
            ribbon: this.scroller(),
            key: programsFocusKey(this.ctx.programs()),
        }),
        {
            equal: (left, right) =>
                left.ribbon === right.ribbon && left.key === right.key,
        }
    );
    /**
     * Estimated once per channel or ribbon mount, then moved only by the
     * scroll and resize measurements: a live estimate would follow the 30 s
     * now tick and the centred day away from what the ribbon shows.
     */
    private readonly viewport = linkedSignal<unknown, TimelineViewport>({
        source: this.identity,
        computation: () => untracked(() => this.initialViewport()),
    });
    private readonly range = computed(() =>
        timelineWindowRange(this.viewport(), this.ctx.axis(), this.ctx.scale())
    );

    readonly items = computed(() =>
        renderItemsInRange(this.ctx.renderItems(), this.range())
    );
    readonly ticks = computed(() =>
        marksInRange(this.ctx.ticks(), this.ctx.scale(), this.range())
    );
    readonly dividers = computed(() =>
        marksInRange(this.ctx.dividers(), this.ctx.scale(), this.range())
    );

    constructor(private readonly ctx: TimelineWindowHost) {
        effect((onCleanup) => {
            const scroller = this.scroller();
            if (scroller) {
                onCleanup(this.observe(scroller));
            }
        });
    }

    /** Re-measure on the next frame (scroll); repeated calls coalesce. */
    scheduleMeasure(): void {
        if (this.measureFrame) {
            return;
        }
        this.measureFrame = requestAnimationFrame(() => {
            this.measureFrame = 0;
            this.measure();
        });
    }

    /** Follow the ribbon's scrolling and size; returns the cleanup. */
    private observe(ribbon: HTMLElement): () => void {
        const onScroll = () => this.scheduleMeasure();
        ribbon.addEventListener('scroll', onScroll, { passive: true });
        const observer =
            typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver(() => this.measureWidth());
        observer?.observe(ribbon);
        return () => {
            ribbon.removeEventListener('scroll', onScroll);
            observer?.disconnect();
            cancelAnimationFrame(this.measureFrame);
            this.measureFrame = 0;
        };
    }

    /**
     * A resize widens the window around its current centre and never moves
     * it: the observer's first report can come before the auto-focus scroll,
     * while the ribbon is still at its left edge.
     */
    measureWidth(): void {
        const widthPx = this.scroller()?.clientWidth ?? 0;
        const current = this.viewport();
        if (widthPx > current.widthPx) {
            this.viewport.set({ centreMs: current.centreMs, widthPx });
        }
    }

    /**
     * Re-centres the window on the ribbon minute a scale change is about to
     * show, in the same pass as the new scale. The scroll event that would
     * re-measure arrives only after the anchored `scrollLeft` lands on a
     * later frame; until then the window would be the previous centre at the
     * new scale, which can be far from what the ribbon shows.
     */
    centreOnMinute(offsetMin: number): void {
        this.viewport.set({
            centreMs: this.ctx.axis().startMs + offsetMin * TIMELINE_MINUTE_MS,
            widthPx: this.viewport().widthPx,
        });
    }

    /** Follow the scroll position: re-centre once it moved far enough. */
    measure(): void {
        const scroller = this.scroller();
        if (!scroller || scroller.clientWidth <= 0) {
            return;
        }
        const scale = this.ctx.scale();
        const next = viewportFromScroller(
            scroller.scrollLeft,
            scroller.clientWidth,
            this.ctx.axis(),
            scale
        );
        if (viewportNeedsWindow(this.viewport(), next, scale)) {
            this.viewport.set(next);
        }
    }

    private scroller(): HTMLElement | undefined {
        return this.ctx.ribbon()?.nativeElement;
    }

    private initialViewport(): TimelineViewport {
        const hostWidth = this.hostElement.nativeElement.clientWidth;
        const widthPx =
            hostWidth > 0
                ? hostWidth
                : typeof window === 'undefined'
                  ? 0
                  : window.innerWidth;
        const dayKey = this.ctx.viewDayKey();
        if (dayKey !== getTodayEpgDateKey()) {
            return {
                centreMs:
                    parseEpgDateKey(dayKey).getTime() +
                    12 * 60 * TIMELINE_MINUTE_MS,
                widthPx,
            };
        }
        const current = this.ctx.blocks().find((block) => block.when === 'now');
        return {
            centreMs: current
                ? (current.startMs + current.stopMs) / 2
                : this.ctx.nowMs(),
            widthPx,
        };
    }
}
