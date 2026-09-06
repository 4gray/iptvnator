import { ListRange } from '@angular/cdk/collections';
import { DestroyRef } from '@angular/core';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import { EpgGuideFocus } from './epg-guide-keyboard.controller';
import { EPG_GUIDE_ROW_BUFFER } from './epg-guide-layout.util';
import {
    guideBlockRevealScrollLeft,
    guideNowScrollLeft,
    guideRowNeedsReveal,
    scrollElementLeft,
} from './epg-guide-scroll.util';
import { EpgGuideChannel } from './epg-guide-source';

/** Rows kept above the keyboard focus when it is scrolled into view. */
const FOCUS_ROW_MARGIN = 2;
/** Rows kept above the playing channel when the guide jumps to now. */
const ACTIVE_ROW_MARGIN = 3;
/** Rows requested before the viewport has reported a rendered range. */
const INITIAL_LOAD_ROWS = 30;

export interface EpgGuideViewportHost {
    viewport(): CdkVirtualScrollViewport | undefined;
    rows(): readonly EpgGuideChannel[];
    rowHeightPx(): number;
    channelColumnPx(): number;
    blocksFor(row: number): TimelineRenderBlock[];
    activeRow(): number;
    ensureLoaded(channels: readonly EpgGuideChannel[]): void;
}

/**
 * Scrolling and lazy loading for the guide's virtual viewport: which rows the
 * programme cache is asked about, where "now" and the keyboard focus are
 * scrolled to. Split out of the shell component, which owns state and
 * rendering only.
 */
export class EpgGuideViewportController {
    private renderedRange: ListRange | null = null;

    constructor(private readonly host: EpgGuideViewportHost) {}

    /** Reload as the viewport renders new rows, until the host is destroyed. */
    watch(viewport: CdkVirtualScrollViewport, destroyRef: DestroyRef): void {
        viewport.renderedRangeStream
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe((range) => {
                this.renderedRange = range;
                this.loadRenderedRange();
            });
    }

    /**
     * Request programmes for the rendered rows plus a buffer. Before the
     * viewport has measured itself (it reports nothing in a zero-sized host,
     * e.g. jsdom) the first screenful is requested instead, so the guide is
     * never blank waiting for a range that will not arrive.
     */
    loadRenderedRange(): void {
        const rows = this.host.rows();
        const range = this.renderedRange ?? {
            start: 0,
            end: Math.min(rows.length, INITIAL_LOAD_ROWS),
        };
        const start = Math.max(0, range.start - EPG_GUIDE_ROW_BUFFER);
        const end = Math.min(rows.length, range.end + EPG_GUIDE_ROW_BUFFER);
        this.host.ensureLoaded(rows.slice(start, end));
    }

    /** Put the now-line into view, and the playing channel's row with it. */
    scrollToNow(nowLeftPx: number | null, animate: boolean): void {
        const viewport = this.host.viewport();
        if (!viewport || nowLeftPx === null) {
            return;
        }
        const element = viewport.elementRef.nativeElement;
        scrollElementLeft(
            element,
            guideNowScrollLeft(
                element.clientWidth,
                nowLeftPx,
                this.host.channelColumnPx()
            ),
            animate
        );
        const activeRow = this.host.activeRow();
        if (activeRow >= 0) {
            viewport.scrollToIndex(
                Math.max(0, activeRow - ACTIVE_ROW_MARGIN),
                animate ? 'smooth' : 'auto'
            );
        }
    }

    /** Keep the keyboard focus target inside the viewport, both axes. */
    revealFocus(focused: EpgGuideFocus | null): void {
        const viewport = this.host.viewport();
        if (!focused || !viewport) {
            return;
        }
        const element = viewport.elementRef.nativeElement;
        if (
            guideRowNeedsReveal(
                focused.row,
                this.host.rowHeightPx(),
                viewport.measureScrollOffset('top'),
                element.clientHeight
            )
        ) {
            viewport.scrollToIndex(Math.max(0, focused.row - FOCUS_ROW_MARGIN));
        }
        if (focused.block === null) {
            return;
        }
        const block = this.host.blocksFor(focused.row)[focused.block];
        const left =
            block &&
            guideBlockRevealScrollLeft(
                block,
                element.scrollLeft,
                element.clientWidth,
                this.host.channelColumnPx()
            );
        if (typeof left === 'number') {
            scrollElementLeft(element, left, true);
        }
    }
}
