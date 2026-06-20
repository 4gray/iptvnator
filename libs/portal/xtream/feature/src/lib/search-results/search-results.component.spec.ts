import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
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

describe('SearchResultsComponent initialQuery contract', () => {
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
                                layout: 'workspace',
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

    it('applies initialQuery when opened as global search', () => {
        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: true,
                        initialQuery: 'matrix',
                    },
                    undefined
                )
        );

        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        expect(store.setSearchTerm).toHaveBeenCalledWith('matrix');
        expect(component.searchTerm()).toBe('matrix');
    });

    it('does not force search term when initialQuery is not provided', () => {
        TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: true,
                    },
                    undefined
                )
        );

        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        expect(store.setSearchTerm).not.toHaveBeenCalled();
    });

    it('clears the workspace global search term when the route q param is empty', () => {
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        store.searchTerm.set('matrix');

        const component = TestBed.runInInjectionContext(
            () => new SearchResultsComponent(null, undefined)
        );
        TestBed.flushEffects();

        expect(store.setSearchTerm).toHaveBeenCalledWith('');
        expect(component.searchTerm()).toBe('');
    });

    it('navigates global search selection to workspace xtream route', () => {
        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: true,
                    },
                    undefined
                )
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
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: true,
                    },
                    undefined
                )
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
        const databaseService = TestBed.inject(DatabaseService) as {
            globalSearchContent: jest.Mock;
        };
        databaseService.globalSearchContent
            .mockReturnValueOnce(staleSearch.promise)
            .mockResolvedValueOnce(freshResults);

        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: true,
                    },
                    undefined
                )
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
        const databaseService = TestBed.inject(DatabaseService) as {
            globalSearchContent: jest.Mock;
        };
        databaseService.globalSearchContent
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(secondPage);

        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: true,
                    },
                    undefined
                )
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
        const databaseService = TestBed.inject(DatabaseService) as {
            globalSearchContent: jest.Mock;
        };
        databaseService.globalSearchContent
            .mockReturnValueOnce(appendSearch.promise)
            .mockReturnValueOnce(freshSearch.promise);

        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: true,
                    },
                    undefined
                )
        );
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        store.searchResults.set([createSearchItem()]);
        component.hasMoreGlobalResults.set(true);

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
        const databaseService = TestBed.inject(DatabaseService) as {
            globalSearchContent: jest.Mock;
        };
        databaseService.globalSearchContent.mockResolvedValueOnce(nextPage);

        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: true,
                    },
                    undefined
                )
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
});
