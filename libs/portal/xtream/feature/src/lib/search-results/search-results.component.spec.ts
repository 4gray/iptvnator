import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { DatabaseService } from '@iptvnator/services';
import { SearchResultsComponent } from './search-results.component';
import {
    SearchFilters,
    XtreamContentItem,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { GlobalSearchResult } from '@iptvnator/shared/interfaces';

jest.mock('@iptvnator/portal/shared/ui', () => ({
    ContentCardComponent: class {},
    SearchLayoutComponent: class {},
}));

const DEFAULT_SEARCH_FILTERS: SearchFilters = {
    live: true,
    movie: true,
    series: true,
};

function createSearchItem(
    overrides: Partial<XtreamContentItem> = {}
): XtreamContentItem {
    return {
        id: 1,
        category_id: 123,
        title: 'Matrix',
        rating: '0',
        added: '0',
        poster_url: '',
        xtream_id: 456,
        type: 'movie',
        ...overrides,
    };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

class MockXtreamStore {
    readonly searchTerm = signal('');
    readonly searchFilters = signal(DEFAULT_SEARCH_FILTERS);
    readonly searchResults = signal<XtreamContentItem[]>([]);
    readonly isSearching = signal(false);
    readonly isLoadingContent = signal(false);
    readonly isLoadingCategories = signal(false);
    readonly isImporting = signal(false);

    setSearchTerm = jest.fn((term: string) => {
        this.searchTerm.set(term);
    });
    setSearchFilters = jest.fn((filters: SearchFilters) => {
        this.searchFilters.set(filters);
    });
    updateSearchFilter = jest.fn();
    setGlobalSearchResults = jest.fn((items: XtreamContentItem[]) => {
        this.searchResults.set(items);
    });
    setIsSearching = jest.fn((state: boolean) => {
        this.isSearching.set(state);
    });
    resetSearchResults = jest.fn();
    searchContent = jest.fn();
    setSelectedContentType = jest.fn();
}

describe('SearchResultsComponent global search', () => {
    let routerNavigateMock: jest.Mock;

    beforeEach(() => {
        routerNavigateMock = jest.fn();

        TestBed.configureTestingModule({
            providers: [
                {
                    provide: XtreamStore,
                    useClass: MockXtreamStore,
                },
                {
                    provide: Router,
                    useValue: {
                        navigate: routerNavigateMock,
                    },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {
                                isGlobalSearch: true,
                            },
                            queryParamMap: convertToParamMap({ q: '' }),
                        },
                        queryParamMap: of(convertToParamMap({ q: '' })),
                    },
                },
                {
                    provide: DatabaseService,
                    useValue: {
                        globalSearchContent: jest.fn().mockResolvedValue([]),
                    },
                },
            ],
        });
    });

    it('clears the workspace global search term when the route q param is empty', () => {
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        store.searchTerm.set('matrix');

        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent()
        );
        TestBed.flushEffects();

        expect(store.setSearchTerm).toHaveBeenCalledWith('');
        expect(component.searchTerm()).toBe('');
        expect(component.isGlobalSearch).toBe(true);
        expect(component.backAvailable).toBe(false);
    });

    it('navigates global search selection to workspace xtream route', () => {
        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent()
        );

        component.selectItem(
            createSearchItem({
                playlist_id: 'playlist-1',
            })
        );

        expect(routerNavigateMock).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'playlist-1', 'vod', '123', '456'],
            {
                state: undefined,
            }
        );
    });

    it('navigates M3U global search selection to the M3U player with route state', () => {
        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent()
        );
        const channel = {
            id: 'channel-news',
            url: 'https://stream.test/news.m3u8',
            name: 'Daily News',
            group: { title: 'News' },
            tvg: {
                id: 'daily-news',
                name: 'Daily News HD',
                url: '',
                logo: '',
                rec: '',
            },
            http: {
                referrer: '',
                'user-agent': '',
                origin: '',
            },
            radio: '',
        };

        component.selectItem({
            source_type: 'm3u',
            content_type: 'live',
            playlist_id: 'm3u-1',
            playlist_name: 'M3U One',
            channel_id: 'channel-news',
            stream_url: 'https://stream.test/news.m3u8',
            group_title: 'News',
            radio: '',
            poster_url: '',
            channel,
            id: 'm3u-1::channel-news',
            category_id: 'm3u',
            title: 'Daily News',
            rating: '',
            added: '',
            xtream_id: 0,
            type: 'live',
        } satisfies GlobalSearchResult);

        expect(routerNavigateMock).toHaveBeenCalledWith(
            ['/workspace', 'playlists', 'm3u-1', 'all'],
            {
                state: {
                    openM3uChannelUrl: 'https://stream.test/news.m3u8',
                },
            }
        );
    });

    it('ignores stale global search responses once a newer search has completed', async () => {
        const staleSearch = createDeferred<XtreamContentItem[]>();
        const freshResults = [
            createSearchItem({ xtream_id: 777, title: 'Fresh result' }),
        ];
        const databaseService = TestBed.inject(DatabaseService) as unknown as {
            globalSearchContent: jest.Mock;
        };
        databaseService.globalSearchContent
            .mockReturnValueOnce(staleSearch.promise)
            .mockResolvedValueOnce(freshResults);

        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent()
        );
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;

        const stalePromise = component.searchGlobal('mat', ['movie']);
        const freshPromise = component.searchGlobal('matrix', ['movie']);

        await freshPromise;
        expect(store.searchResults()).toEqual(freshResults);

        staleSearch.resolve([
            createSearchItem({ xtream_id: 1, title: 'Stale result' }),
        ]);
        await stalePromise;

        expect(store.searchResults()).toEqual(freshResults);
    });

    it('loads additional global search pages and appends them to existing results', async () => {
        const firstPage = Array.from({ length: 101 }, (_, index) =>
            createSearchItem({
                id: index + 1,
                title: `Result ${index + 1}`,
                xtream_id: index + 1,
            })
        );
        const secondPage = [
            createSearchItem({
                id: 102,
                title: 'Result 102',
                xtream_id: 102,
            }),
        ];
        const databaseService = TestBed.inject(DatabaseService) as unknown as {
            globalSearchContent: jest.Mock;
        };
        databaseService.globalSearchContent
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(secondPage);

        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent()
        );
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;

        await component.searchGlobal('matrix', ['movie'], false);

        expect(databaseService.globalSearchContent).toHaveBeenCalledWith(
            'matrix',
            ['movie'],
            false,
            undefined,
            {
                limit: 101,
                offset: 0,
            }
        );
        expect(store.searchResults()).toHaveLength(100);
        expect(component.hasMoreGlobalResults()).toBe(true);

        await component.loadMoreGlobalResults();

        expect(databaseService.globalSearchContent).toHaveBeenLastCalledWith(
            'matrix',
            ['movie'],
            false,
            undefined,
            {
                limit: 101,
                offset: 100,
            }
        );
        expect(store.searchResults()).toHaveLength(101);
        expect(store.searchResults()[100].title).toBe('Result 102');
        expect(component.hasMoreGlobalResults()).toBe(false);
    });

    it('clears the load-more indicator when a new global search supersedes pagination', async () => {
        const appendSearch = createDeferred<XtreamContentItem[]>();
        const freshSearch = createDeferred<XtreamContentItem[]>();
        const databaseService = TestBed.inject(DatabaseService) as unknown as {
            globalSearchContent: jest.Mock;
        };
        databaseService.globalSearchContent
            .mockReturnValueOnce(appendSearch.promise)
            .mockReturnValueOnce(freshSearch.promise);

        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent()
        );
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        store.searchResults.set([createSearchItem()]);
        component.hasMoreGlobalResults.set(true);
        // Appends only continue the last executed search.
        (
            component as unknown as { lastGlobalSearchTerm: string }
        ).lastGlobalSearchTerm = 'matrix';

        const appendPromise = component.searchGlobal(
            'matrix',
            ['movie'],
            false,
            true
        );
        expect(component.isLoadingMoreGlobalResults()).toBe(true);

        const freshPromise = component.searchGlobal('news', ['live'], false);

        expect(component.isLoadingMoreGlobalResults()).toBe(false);

        appendSearch.resolve([]);
        freshSearch.resolve([]);
        await Promise.all([appendPromise, freshPromise]);
    });

    it('uses the rendered global search results when calculating the next page offset', async () => {
        const nextPage = [
            createSearchItem({
                id: 2,
                title: 'Result 2',
                xtream_id: 2,
            }),
        ];
        const databaseService = TestBed.inject(DatabaseService) as unknown as {
            globalSearchContent: jest.Mock;
        };
        databaseService.globalSearchContent.mockResolvedValueOnce(nextPage);

        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent()
        );
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        store.searchResults.set([createSearchItem({ id: 1, xtream_id: 1 })]);
        (
            store as unknown as {
                globalSearchResults: ReturnType<
                    typeof signal<XtreamContentItem[]>
                >;
            }
        ).globalSearchResults = signal([]);
        component.hasMoreGlobalResults.set(true);
        // Appends only continue the last executed search.
        (
            component as unknown as { lastGlobalSearchTerm: string }
        ).lastGlobalSearchTerm = 'matrix';

        await component.searchGlobal('matrix', ['movie'], false, true);

        expect(databaseService.globalSearchContent).toHaveBeenCalledWith(
            'matrix',
            ['movie'],
            false,
            undefined,
            {
                limit: 101,
                offset: 1,
            }
        );
        expect(store.searchResults()).toHaveLength(2);
    });

    it('refuses to append pages while an edited query is still debouncing', async () => {
        // Regression: the auto-fill can request more results right after the
        // reset identity changes, before the search effect has run. An
        // append with the edited term would fetch a page of the NEW query at
        // the OLD offset and interleave it into the old query's results.
        const firstPage = Array.from({ length: 101 }, (_, index) =>
            createSearchItem({
                id: index + 1,
                title: `Result ${index + 1}`,
                xtream_id: index + 1,
            })
        );
        const databaseService = TestBed.inject(DatabaseService) as unknown as {
            globalSearchContent: jest.Mock;
        };
        databaseService.globalSearchContent.mockResolvedValueOnce(firstPage);

        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent()
        );
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;

        await component.searchGlobal('matrix', ['movie'], false);
        expect(component.hasMoreGlobalResults()).toBe(true);
        databaseService.globalSearchContent.mockClear();

        // The user edits the query; the fresh offset-zero search has not run
        // yet (effects not flushed), so appending must be refused entirely.
        store.searchTerm.set('matrix reloaded');
        await component.loadMoreGlobalResults();

        expect(databaseService.globalSearchContent).not.toHaveBeenCalled();
        expect(component.isLoadingMoreGlobalResults()).toBe(false);
    });
});

describe('SearchResultsComponent in-portal result window', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: XtreamStore,
                    useClass: MockXtreamStore,
                },
                {
                    provide: Router,
                    useValue: { navigate: jest.fn() },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {},
                            queryParamMap: convertToParamMap({ q: '' }),
                        },
                        queryParamMap: of(convertToParamMap({ q: '' })),
                    },
                },
                {
                    provide: DatabaseService,
                    useValue: {
                        globalSearchContent: jest.fn().mockResolvedValue([]),
                    },
                },
            ],
        });
    });

    it('windows the full result set, reveals further chunks, and resets on a new result set', () => {
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent()
        );
        const items = Array.from({ length: 130 }, (_, index) =>
            createSearchItem({
                id: index + 1,
                xtream_id: index + 1,
                title: `Item ${index + 1}`,
            })
        );
        store.searchResults.set(items);

        expect(component.isGlobalSearch).toBe(false);
        expect(component.backAvailable).toBe(true);
        expect(component.visibleInPortalResults()).toHaveLength(60);
        expect(component.renderedSearchResultsCount()).toBe(60);
        expect(component.hasMoreSearchResults()).toBe(true);

        component.onResultsNearEnd();
        expect(component.visibleInPortalResults()).toHaveLength(120);
        // The layout re-measures on the RENDERED count — it must follow the
        // window, not the constant 130-item total.
        expect(component.renderedSearchResultsCount()).toBe(120);

        component.onResultsNearEnd();
        expect(component.visibleInPortalResults()).toHaveLength(130);
        expect(component.hasMoreSearchResults()).toBe(false);

        // Growing past the total is a no-op.
        component.onResultsNearEnd();
        expect(component.visibleInPortalResults()).toHaveLength(130);

        // A replaced result set resets the window to the first chunk.
        store.searchResults.set(items.slice(0, 90));
        expect(component.visibleInPortalResults()).toHaveLength(60);
        expect(component.hasMoreSearchResults()).toBe(true);
    });

    it('changes the reset identity on filter-only transitions', () => {
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent()
        );

        const initialIdentity = component.searchResetIdentity();

        // Same term, different type filters — the result set is replaced, so
        // the identity feeding the layout's near-end latch must change.
        store.searchFilters.set({ live: false, movie: true, series: true });
        expect(component.searchResetIdentity()).not.toBe(initialIdentity);

        const filteredIdentity = component.searchResetIdentity();
        try {
            component.toggleExcludeHidden(true);
            expect(component.searchResetIdentity()).not.toBe(filteredIdentity);
        } finally {
            // toggleExcludeHidden persists; do not leak into other tests.
            localStorage.removeItem('xtream-search-exclude-hidden');
        }
    });
});

describe('SearchResultsComponent search trigger', () => {
    let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let globalSearchContent: jest.Mock;

    function setUp(initialQuery: string): void {
        queryParams = new BehaviorSubject(
            convertToParamMap({ q: initialQuery })
        );
        globalSearchContent = jest.fn().mockResolvedValue([]);
        TestBed.configureTestingModule({
            providers: [
                { provide: XtreamStore, useClass: MockXtreamStore },
                { provide: Router, useValue: { navigate: jest.fn() } },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: { isGlobalSearch: true },
                            queryParamMap: queryParams.value,
                        },
                        queryParamMap: queryParams.asObservable(),
                    },
                },
                {
                    provide: DatabaseService,
                    useValue: { globalSearchContent },
                },
            ],
        });
    }

    function searchedTerms(): string[] {
        return globalSearchContent.mock.calls.map(([term]) => term as string);
    }

    afterEach(() => {
        jest.useRealTimers();
    });

    it('queries an applied term at once, without a second debounce', () => {
        // The shell already debounces typing; a second timer here only added
        // 300 ms to every search.
        jest.useFakeTimers();
        setUp('');
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        TestBed.runInInjectionContext(() => new SearchResultsComponent());
        TestBed.flushEffects();

        store.setSearchTerm('system');
        TestBed.flushEffects();

        expect(searchedTerms()).toEqual(['system']);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('queries only the route term when the store still holds an older one', () => {
        setUp('system');
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        store.searchTerm.set('matrix');

        TestBed.runInInjectionContext(() => new SearchResultsComponent());
        TestBed.flushEffects();

        expect(searchedTerms()).toEqual(['system']);
    });

    it('keeps a term applied ahead of the URL instead of re-querying the stale q', () => {
        // The shell sets the store term first and writes `q` afterwards; the
        // route sync must not snap the store back to the previous `q`.
        setUp('syst');
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        TestBed.runInInjectionContext(() => new SearchResultsComponent());
        TestBed.flushEffects();
        globalSearchContent.mockClear();

        store.setSearchTerm('system');
        TestBed.flushEffects();
        queryParams.next(convertToParamMap({ q: 'system' }));
        TestBed.flushEffects();

        expect(searchedTerms()).toEqual(['system']);
        expect(store.searchTerm()).toBe('system');
    });

    it('ignores an older query that resolves after a newer term', async () => {
        setUp('');
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        const older = createDeferred<GlobalSearchResult[]>();
        const newer = createDeferred<GlobalSearchResult[]>();
        globalSearchContent
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);
        TestBed.runInInjectionContext(() => new SearchResultsComponent());
        TestBed.flushEffects();

        store.setSearchTerm('syst');
        TestBed.flushEffects();
        store.setSearchTerm('system');
        TestBed.flushEffects();

        newer.resolve([
            createSearchItem({ title: 'System' }) as GlobalSearchResult,
        ]);
        await newer.promise;
        older.resolve([
            createSearchItem({ title: 'Syst' }) as GlobalSearchResult,
        ]);
        await older.promise;
        await Promise.resolve();

        expect(searchedTerms()).toEqual(['syst', 'system']);
        expect(store.searchResults().map((item) => item.title)).toEqual([
            'System',
        ]);
    });
});

describe('SearchResultsComponent in-portal search and catalog loading', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                { provide: XtreamStore, useClass: MockXtreamStore },
                { provide: Router, useValue: { navigate: jest.fn() } },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {},
                            queryParamMap: convertToParamMap({ q: 'matrix' }),
                        },
                        queryParamMap: of(convertToParamMap({ q: 'matrix' })),
                    },
                },
                {
                    provide: DatabaseService,
                    useValue: {
                        globalSearchContent: jest.fn().mockResolvedValue([]),
                    },
                },
            ],
        });
    });

    function searchedTerms(store: MockXtreamStore): string[] {
        return store.searchContent.mock.calls.map(
            ([params]) => (params as { term: string }).term
        );
    }

    it('runs a prefilled search again once the catalog has loaded', () => {
        // The in-portal search reads the loaded catalog, so a term applied
        // while it loads would otherwise stay without results.
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        store.isLoadingContent.set(true);
        TestBed.runInInjectionContext(() => new SearchResultsComponent());
        TestBed.flushEffects();
        expect(searchedTerms(store)).toEqual(['matrix']);

        store.isLoadingContent.set(false);
        TestBed.flushEffects();

        expect(searchedTerms(store)).toEqual(['matrix', 'matrix']);
    });

    it('searches once when a new term and the loaded catalog arrive together', () => {
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        store.isLoadingContent.set(true);
        TestBed.runInInjectionContext(() => new SearchResultsComponent());
        TestBed.flushEffects();
        store.searchContent.mockClear();

        store.setSearchTerm('matrix reloaded');
        store.isLoadingContent.set(false);
        TestBed.flushEffects();

        expect(searchedTerms(store)).toEqual(['matrix reloaded']);
    });

    it('searches once when the catalog is already loaded', () => {
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        TestBed.runInInjectionContext(() => new SearchResultsComponent());
        TestBed.flushEffects();

        expect(searchedTerms(store)).toEqual(['matrix']);
    });
});
