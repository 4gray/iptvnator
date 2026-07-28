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
