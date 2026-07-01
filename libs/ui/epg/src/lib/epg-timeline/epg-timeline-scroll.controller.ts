import { EpgProgram } from '@iptvnator/shared/interfaces';
import { getTodayEpgDateKey, parseEpgDateKey } from '../epg-date';
import {
    dayKeyAtOffset,
    hasProgramsForDateKey,
    TIMELINE_MINUTE_MS,
    TimelineAxis,
    TimelineBlock,
} from './epg-timeline.utils';

/** Accessors the controller reads from the host timeline component's signals. */
export interface TimelineScrollContext {
    readonly ribbon: () => HTMLElement | undefined;
    readonly scale: () => number;
    readonly axis: () => TimelineAxis;
    readonly blocks: () => readonly TimelineBlock[];
    readonly nowMs: () => number;
    readonly viewDayKey: () => string;
    readonly commitDay: (dayKey: string) => void;
    /** Whether the given day-key has any programme in the loaded window. */
    readonly hasProgramsForDay: (dayKey: string) => boolean;
}

/** Stable identity of a channel's programme set (changes when the channel does). */
export function programsFocusKey(programs: readonly EpgProgram[]): string {
    if (programs.length === 0) {
        return '';
    }
    const first = programs[0];
    const last = programs[programs.length - 1];
    return `${first.channel ?? ''}|${programs.length}|${first.start}|${last.stop}`;
}

/**
 * Owns the ribbon's horizontal scrolling and the channel-select auto-focus,
 * keeping that stateful logic out of the presentation component. Instantiated
 * with accessors to the component's signals.
 */
export class TimelineScrollController {
    private scrollFrame = 0;
    private lastFocusKey: string | null = null;
    private lastScroller: HTMLElement | null = null;

    constructor(private readonly ctx: TimelineScrollContext) {}

    /** Centre the current programme (or "now" if none airing) in the viewport. */
    focusCurrentProgram(smooth: boolean): void {
        const axis = this.ctx.axis();
        const current = this.ctx.blocks().find((block) => block.when === 'now');
        const targetMs = current
            ? (current.startMs + current.stopMs) / 2
            : this.ctx.nowMs();
        const offsetMin = (targetMs - axis.startMs) / TIMELINE_MINUTE_MS;
        this.scrollToOffset(offsetMin, 0.5, smooth);
    }

    scrollToDateKey(dateKey: string, frac: number, smooth = true): void {
        const axis = this.ctx.axis();
        const noonMs =
            parseEpgDateKey(dateKey).getTime() + 12 * 60 * TIMELINE_MINUTE_MS;
        const offsetMin = (noonMs - axis.startMs) / TIMELINE_MINUTE_MS;
        this.scrollToOffset(offsetMin, frac, smooth);
    }

    scrollToOffset(offsetMin: number, frac: number, smooth = true): void {
        requestAnimationFrame(() => {
            const scroller = this.ctx.ribbon();
            if (!scroller) {
                return;
            }
            const left =
                offsetMin * this.ctx.scale() - scroller.clientWidth * frac;
            scroller.scrollTo({
                left: Math.max(0, left),
                behavior: smooth ? 'smooth' : 'auto',
            });
        });
    }

    /** Update the centred day as the ribbon scrolls (rAF-throttled). */
    onRibbonScroll(): void {
        if (this.scrollFrame) {
            return;
        }
        this.scrollFrame = requestAnimationFrame(() => {
            this.scrollFrame = 0;
            const scroller = this.ctx.ribbon();
            if (!scroller) {
                return;
            }
            const centerOffsetMin =
                (scroller.scrollLeft + scroller.clientWidth / 2) /
                this.ctx.scale();
            const dayKey = dayKeyAtOffset(this.ctx.axis(), centerOffsetMin);
            // Skip gap days: committing a day with no programmes flips the host
            // to `empty-day` and unmounts the ribbon mid-scroll, stranding the
            // user before the later programmes. Keep the last populated day
            // centred until they scroll into another day that has content.
            if (
                dayKey &&
                dayKey !== this.ctx.viewDayKey() &&
                this.ctx.hasProgramsForDay(dayKey)
            ) {
                this.ctx.commitDay(dayKey);
            }
        });
    }

    /**
     * Centre the current programme when a channel's EPG (re)loads or the ribbon
     * (re)mounts. Deduped by programme-set identity so the 30s "now" tick, zoom
     * changes, or a host re-emitting the same data never re-jump the viewport.
     */
    maybeAutoFocus(
        scroller: HTMLElement | undefined,
        programs: readonly EpgProgram[]
    ): void {
        const key = programsFocusKey(programs);
        // Nothing to centre without a ribbon or programmes.
        if (!scroller || !key) {
            return;
        }
        if (key === this.lastFocusKey) {
            // Same channel already focused. A *new* scroller element means the
            // ribbon was unmounted then remounted (e.g. the inline panel was
            // collapsed and re-expanded), which resets scrollLeft to 0 — restore
            // the viewed day without committing a different day, so the user
            // lands back on their programme rather than the far-left of the
            // guide. The same element (data re-emit / now-tick) is left alone so
            // we never yank the viewport out from under the user.
            if (scroller !== this.lastScroller) {
                this.lastScroller = scroller;
                this.restorePosition();
            }
            return;
        }
        const todayKey = getTodayEpgDateKey();
        // Only auto-focus when today actually has a programme to centre on.
        // Otherwise (today empty, data on other days) leave the user's day
        // navigation alone instead of forcing the view back to an empty today.
        if (!hasProgramsForDateKey(programs, todayKey)) {
            return;
        }
        this.lastFocusKey = key;
        this.lastScroller = scroller;
        this.ctx.commitDay(todayKey);
        // Instant: land already centred, no annoying scroll animation.
        this.focusCurrentProgram(false);
    }

    /**
     * Re-centre the currently-viewed day after the ribbon remounts (which resets
     * scrollLeft). Restores "now" for today, otherwise the viewed day — never
     * commits a different day, so a user parked on another day stays there.
     */
    private restorePosition(): void {
        if (this.ctx.viewDayKey() === getTodayEpgDateKey()) {
            this.focusCurrentProgram(false);
        } else {
            this.scrollToDateKey(this.ctx.viewDayKey(), 0.5, false);
        }
    }
}
