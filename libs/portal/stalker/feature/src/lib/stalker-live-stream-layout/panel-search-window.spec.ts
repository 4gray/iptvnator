import {
    PanelSearchWindow,
    resolvePanelSearchScroll,
} from './panel-search-window';

interface Row {
    readonly id: number;
    readonly name: string;
}

function rows(count: number, name: string): Row[] {
    return Array.from({ length: count }, (_, index) => ({
        id: index,
        name: `${name} ${index}`,
    }));
}

describe('PanelSearchWindow', () => {
    const matches = (row: Row, term: string) =>
        row.name.toLowerCase().includes(term);
    let window: PanelSearchWindow<Row>;
    let source: Row[];

    beforeEach(() => {
        window = new PanelSearchWindow<Row>(100, matches);
        source = [...rows(250, 'Sports TV'), ...rows(20, 'Radio')];
    });

    it('cuts a broad match to one chunk and grows chunk by chunk on demand', () => {
        expect(window.rows('tv', source)).toHaveLength(100);
        expect(window.hasMore()).toBe(true);
        expect(window.activeTerm()).toBe('tv');

        window.loadMore();
        expect(window.rows('tv', source)).toHaveLength(200);
        window.loadMore();
        expect(window.rows('tv', source)).toHaveLength(250);
        expect(window.hasMore()).toBe(false);

        window.loadMore();
        expect(window.rows('tv', source)).toHaveLength(250);
    });

    it('starts a new term at one chunk again', () => {
        window.rows('tv', source);
        window.loadMore();
        expect(window.rows('tv', source)).toHaveLength(200);

        expect(window.rows('sports', source)).toHaveLength(100);
        expect(window.rows('radio', source)).toHaveLength(20);
        expect(window.hasMore()).toBe(false);
    });

    it('memoizes the match list per term and source', () => {
        const spy = jest.fn(matches);
        window = new PanelSearchWindow<Row>(100, spy);

        window.rows('tv', source);
        const calls = spy.mock.calls.length;
        window.rows('tv', source);
        expect(spy.mock.calls.length).toBe(calls);

        window.rows('tv', [...source]);
        expect(spy.mock.calls.length).toBeGreaterThan(calls);
    });

    it('forgets the term when the panel search is cleared', () => {
        window.rows('tv', source);
        window.clear();

        expect(window.activeTerm()).toBe('');
        expect(window.hasMore()).toBe(false);
        window.loadMore();
        expect(window.rows('tv', source)).toHaveLength(100);
    });

    it('starts over when the user backspaces to a term grown earlier', () => {
        // The window belongs to one run of edits: refining "tv" to "tvx" and
        // deleting the x again must not remount the 200 rows "tv" had grown
        // to, which would defeat the guard the window exists for.
        window.rows('tv', source);
        window.loadMore();
        expect(window.rows('tv', source)).toHaveLength(200);

        expect(window.rows('tvx', source)).toHaveLength(0);
        expect(window.rows('tv', source)).toHaveLength(100);
        expect(window.hasMore()).toBe(true);
    });

    it('starts over when the search is cleared and the term typed again', () => {
        window.rows('tv', source);
        window.loadMore();
        window.clear();

        expect(window.rows('tv', source)).toHaveLength(100);
    });

    it('keeps the grown window when the source refreshes under the same term', () => {
        // A paged portal appends a page: the matches the user scrolled
        // through must stay on screen, with the new ones behind them.
        window.rows('tv', source);
        window.loadMore();

        const refreshed = [...source, ...rows(30, 'More TV')];
        expect(window.rows('tv', refreshed)).toHaveLength(200);
        expect(window.hasMore()).toBe(true);
    });
});

describe('resolvePanelSearchScroll', () => {
    it('does nothing away from the end of the list', () => {
        expect(
            resolvePanelSearchScroll({
                isPanelSearch: true,
                isNearEnd: false,
                panelHasMore: true,
            })
        ).toBe('idle');
    });

    it('grows the panel window while it still hides loaded matches', () => {
        expect(
            resolvePanelSearchScroll({
                isPanelSearch: true,
                isNearEnd: true,
                panelHasMore: true,
            })
        ).toBe('grow-window');
    });

    it('reaches provider pagination once the window covers every loaded match', () => {
        // A paged portal can hold matches on pages never fetched, so stopping
        // at the exhausted window would hide them from the panel for good.
        expect(
            resolvePanelSearchScroll({
                isPanelSearch: true,
                isNearEnd: true,
                panelHasMore: false,
            })
        ).toBe('load-page');
    });

    it('pages the sidebar list, which has no panel window', () => {
        expect(
            resolvePanelSearchScroll({
                isPanelSearch: false,
                isNearEnd: true,
                panelHasMore: false,
            })
        ).toBe('load-page');
    });
});
