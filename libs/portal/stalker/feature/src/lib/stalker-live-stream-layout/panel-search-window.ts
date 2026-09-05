import { signal } from '@angular/core';

interface PanelSearchMemo<T> {
    readonly term: string;
    readonly source: readonly T[];
    readonly result: T[];
}

/** What a scroll near the end of a stamped channel list should do next. */
export type PanelSearchScrollAction = 'idle' | 'grow-window' | 'load-page';

/**
 * A panel search grows its own window over the matches already loaded, but
 * only while that window still hides some: on a paged portal (or a censored
 * category absent from the full-list cache) the term may also match channels
 * on pages that were never fetched, so once the window covers everything
 * loaded the scroll has to reach provider pagination instead of stopping.
 */
export function resolvePanelSearchScroll(state: {
    readonly isPanelSearch: boolean;
    readonly isNearEnd: boolean;
    readonly panelHasMore: boolean;
}): PanelSearchScrollAction {
    if (!state.isNearEnd) {
        return 'idle';
    }
    return state.isPanelSearch && state.panelHasMore
        ? 'grow-window'
        : 'load-page';
}

/**
 * Memoized, windowed matches for the fullscreen channel panel's own search
 * field.
 *
 * In full-list mode the search source is the portal's entire channel list,
 * and a broad term ("tv") matches most of it. The panel renders one
 * `app-channel-list-item` per row without virtual scrolling, so the matches
 * are rendered through the same bounded window the sidebar uses: `chunk`
 * rows first, another `chunk` each time the panel's list scrolls near its
 * end. The window belongs to the term it was grown for — a new term starts
 * at one chunk again — and the match list itself is memoized per
 * term + source so re-renders do not re-filter thousands of rows.
 */
export class PanelSearchWindow<T> {
    private readonly window = signal<{ term: string; limit: number }>({
        term: '',
        limit: 0,
    });
    private memo: PanelSearchMemo<T> | null = null;

    constructor(
        private readonly chunk: number,
        private readonly matches: (item: T, term: string) => boolean
    ) {}

    /**
     * Rows to render for a non-empty `term` over `source`: the matches, cut to
     * the current window. Reads the window signal, so a template calling this
     * re-renders when {@link loadMore} grows it.
     */
    rows(term: string, source: readonly T[]): T[] {
        const memo = this.memo;
        const result =
            memo && memo.term === term && memo.source === source
                ? memo.result
                : source.filter((item) => this.matches(item, term));
        this.memo = { term, source, result };
        return result.slice(0, this.limitFor(term));
    }

    /** The panel's search field is empty again: nothing to window. */
    clear(): void {
        this.memo = null;
    }

    /** The term the last {@link rows} call matched against, '' when cleared. */
    activeTerm(): string {
        return this.memo?.term ?? '';
    }

    hasMore(): boolean {
        const memo = this.memo;
        return memo !== null && memo.result.length > this.limitFor(memo.term);
    }

    /** Grows the window over the active term's matches by one chunk. */
    loadMore(): void {
        const memo = this.memo;
        if (memo === null || !this.hasMore()) {
            return;
        }
        this.window.set({
            term: memo.term,
            limit: this.limitFor(memo.term) + this.chunk,
        });
    }

    private limitFor(term: string): number {
        const window = this.window();
        return window.term === term ? window.limit : this.chunk;
    }
}
