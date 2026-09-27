import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import {
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
} from '@iptvnator/shared/logging';
import { XTREAM_DATA_SOURCE } from '../../data-sources/xtream-data-source.interface';
import { withSearch } from './with-search.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({ error: jest.fn() }),
}));

const performanceHookSymbol = Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY);
const TestSearchStore = signalStore(
    withState({ playlistId: 'playlist-1' }),
    withSearch()
);

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, reject, resolve };
}

function setPerformanceHook(
    hook: ((event: RendererPerformancePhaseEvent) => void) | null
): void {
    const target = globalThis as unknown as Record<symbol, unknown>;
    if (hook === null) {
        delete target[performanceHookSymbol];
    } else {
        target[performanceHookSymbol] = hook;
    }
}

describe('withSearch renderer performance markers', () => {
    let searchContent: jest.Mock;
    let store: InstanceType<typeof TestSearchStore>;

    beforeEach(() => {
        searchContent = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                TestSearchStore,
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: { searchContent },
                },
            ],
        });
        store = TestBed.inject(TestSearchStore);
    });

    afterEach(() => setPerformanceHook(null));

    it('marks only the authoritative non-stale result publication', async () => {
        const events: RendererPerformancePhaseEvent[] = [];
        const first = createDeferred<unknown[]>();
        const second = createDeferred<unknown[]>();
        setPerformanceHook((event) => events.push(event));
        searchContent
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const staleSearch = store.searchContent('old', ['live']);
        const authoritativeSearch = store.searchContent('new', ['live']);
        second.resolve([{ xtream_id: 2 }, { xtream_id: 3 }]);
        await authoritativeSearch;
        first.resolve([{ xtream_id: 1 }]);
        await staleSearch;

        expect(store.searchResults()).toEqual([
            { xtream_id: 2 },
            { xtream_id: 3 },
        ]);
        expect(
            events.map(({ boundary, metadata, outcome, phase }) => ({
                boundary,
                items: metadata?.items,
                outcome,
                phase,
            }))
        ).toEqual([
            {
                boundary: 'start',
                items: 2,
                outcome: undefined,
                phase: 'store.xtream-search-results',
            },
            {
                boundary: 'end',
                items: 2,
                outcome: 'success',
                phase: 'store.xtream-search-results',
            },
        ]);
    });

    it('does not mark an error-state reset', async () => {
        const events: RendererPerformancePhaseEvent[] = [];
        setPerformanceHook((event) => events.push(event));
        searchContent.mockRejectedValue(new Error('search failed'));

        await expect(store.searchContent('query', ['movie'])).resolves.toEqual(
            []
        );

        expect(store.searchResults()).toEqual([]);
        expect(events).toEqual([]);
    });
});

describe('withSearch refreshSearchResults', () => {
    let searchContent: jest.Mock;
    let store: InstanceType<typeof TestSearchStore>;

    beforeEach(() => {
        searchContent = jest.fn(async () => [{ xtream_id: 1 }]);
        TestBed.configureTestingModule({
            providers: [
                TestSearchStore,
                { provide: XTREAM_DATA_SOURCE, useValue: { searchContent } },
            ],
        });
        store = TestBed.inject(TestSearchStore);
    });

    it('re-runs the last search with the parameters it was issued with', async () => {
        await store.searchContent({
            term: 'news',
            types: ['live'],
            excludeHidden: true,
        });
        searchContent.mockResolvedValueOnce([]);

        await store.refreshSearchResults();

        expect(searchContent).toHaveBeenLastCalledWith(
            'playlist-1',
            'news',
            ['live'],
            true
        );
        expect(store.searchResults()).toEqual([]);
    });

    it('clears stored results without forgetting the last search', async () => {
        await store.searchContent('news', ['live']);
        expect(store.searchResults()).toHaveLength(1);

        store.clearSearchResults();
        expect(store.searchResults()).toEqual([]);

        await store.refreshSearchResults();
        expect(searchContent).toHaveBeenCalledTimes(2);
        expect(store.searchResults()).toHaveLength(1);
    });

    it('retires a search still in flight when the results are cleared', async () => {
        const pending = createDeferred<unknown[]>();
        searchContent.mockReturnValueOnce(pending.promise);
        const running = store.searchContent('news', ['live']);

        store.clearSearchResults();
        pending.resolve([{ xtream_id: 1 }]);
        await running;

        expect(store.searchResults()).toEqual([]);
    });

    it('does nothing without a previous search or after a reset', async () => {
        await store.refreshSearchResults();
        expect(searchContent).not.toHaveBeenCalled();

        await store.searchContent('news', ['live']);
        store.resetSearchResults();
        await store.refreshSearchResults();
        expect(searchContent).toHaveBeenCalledTimes(1);
    });
});
