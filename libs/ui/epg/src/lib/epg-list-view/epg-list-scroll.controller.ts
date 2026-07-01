import { EpgListRow } from './epg-list-view.utils';

export interface EpgListScrollDeps {
    /** The scrollable `.g-list` element (undefined before first render). */
    readonly list: () => HTMLElement | undefined;
    /** Whether the viewed day is today (auto-focus/now-strip are today-only). */
    readonly isViewToday: () => boolean;
    /** Toggle the sticky now-strip's visibility. */
    readonly setNowStripVisible: (visible: boolean) => void;
}

/**
 * Vertical-list scroll behaviour extracted from the component: auto-focus the
 * on-air row when a channel's EPG (re)loads, keep the sticky "now" strip in sync
 * with scroll position, and reset scroll on day changes. The vertical analogue
 * of the timeline's `TimelineScrollController`.
 */
export class EpgListScrollController {
    private autoScrollKey: string | null = null;
    private lastList: HTMLElement | null = null;

    constructor(private readonly deps: EpgListScrollDeps) {}

    /**
     * Scroll the on-air row into view once per channel/EPG load, today only.
     * A *new* list element under an unchanged key means the body was unmounted
     * and remounted (the inline panel was collapsed and re-expanded), which
     * resets scrollTop to 0 — restore the now-row instead of stranding the user
     * at the top of the day. The same element (data re-emit / 30s now-tick) is
     * left alone so the viewport is never yanked out from under the user.
     */
    maybeAutoScroll(
        list: HTMLElement | undefined,
        rows: EpgListRow[],
        today: boolean,
        channel: string
    ): void {
        if (!list || !today) {
            return;
        }
        const now = rows.find((row) => row.when === 'now');
        if (!now) {
            return;
        }
        // Programme-SET identity (like the timeline's `programsFocusKey`), NOT
        // the on-air row's key: the latter changes at every programme rollover
        // (the 30s tick reclassifies `when`), which would re-trigger the scroll
        // and yank the viewport away from wherever the user scrolled to.
        const first = rows[0];
        const last = rows[rows.length - 1];
        const key = `${channel}|${rows.length}|${first.startMs}|${last.stopMs}`;
        if (key === this.autoScrollKey) {
            if (list !== this.lastList) {
                this.lastList = list;
                this.focusNowAfterRender();
            } else {
                // No scroll — but keep the now-strip honest: layout can change
                // without scroll events (panel resize, rows re-render), and a
                // non-scrollable list never fires scroll to self-correct.
                this.updateNowStrip();
            }
            return;
        }
        this.autoScrollKey = key;
        this.lastList = list;
        this.focusNowAfterRender();
    }

    /**
     * Scroll to the now-row after the next render. Public for the toolbar
     * "Now" jump: committing today re-renders the rows, so a synchronous DOM
     * query would still see the previous day's rows and find no now-row —
     * the deferral lets change detection paint today first.
     */
    focusNowAfterRender(animate = false): void {
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                this.scrollNowIntoView(animate);
                this.updateNowStrip();
            })
        );
    }

    scrollNowIntoView(animate: boolean): void {
        const list = this.deps.list();
        const nowRow = this.nowRowElement(list);
        if (list && nowRow) {
            // Rect-based, relative to the scroller itself: `offsetTop` is
            // measured against the nearest *positioned* ancestor, which is
            // outside the list (the rows/list are not positioned), so it would
            // include the player above and scroll to a wildly wrong spot.
            const listRect = list.getBoundingClientRect();
            const rowRect = nowRow.getBoundingClientRect();
            const top = list.scrollTop + (rowRect.top - listRect.top) - 8;
            list.scrollTo({
                top: Math.max(0, top),
                behavior: animate ? 'smooth' : 'auto',
            });
        }
    }

    resetListScroll(): void {
        const list = this.deps.list();
        if (list) {
            list.scrollTop = 0;
        }
        this.deps.setNowStripVisible(false);
    }

    /** Show the condensed now-strip only when the on-air row is scrolled away. */
    updateNowStrip(): void {
        const list = this.deps.list();
        const nowRow = this.nowRowElement(list);
        if (!list || !nowRow || !this.deps.isViewToday()) {
            this.deps.setNowStripVisible(false);
            return;
        }
        // A list that doesn't scroll can't have scrolled the row away — and it
        // also never fires scroll events to clear a stale strip.
        if (list.scrollHeight <= list.clientHeight) {
            this.deps.setNowStripVisible(false);
            return;
        }
        // Rect-based for the same reason as scrollNowIntoView.
        const listRect = list.getBoundingClientRect();
        const rowRect = nowRow.getBoundingClientRect();
        if (rowRect.height <= 0) {
            this.deps.setNowStripVisible(false);
            return;
        }
        const visible =
            Math.min(rowRect.bottom, listRect.bottom) -
            Math.max(rowRect.top, listRect.top);
        this.deps.setNowStripVisible(visible / rowRect.height < 0.5);
    }

    private nowRowElement(
        list: HTMLElement | undefined
    ): HTMLElement | null {
        return (
            list?.querySelector<HTMLElement>('.g-row[data-when="now"]') ?? null
        );
    }
}
