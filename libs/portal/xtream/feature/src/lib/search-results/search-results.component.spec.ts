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
                new SearchResultsComponent({
                    isGlobalSearch: true,
                }, undefined)
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
});
