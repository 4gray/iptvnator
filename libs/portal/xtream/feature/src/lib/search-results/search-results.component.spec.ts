import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { DatabaseService } from 'services';
import { SearchResultsComponent } from './search-results.component';
import {
    SearchFilters,
    XtreamContentItem,
    XtreamStore,
    matchesXtreamLanguageFilter,
    matchesXtreamVideoQualityFilter,
} from '@iptvnator/portal/xtream/data-access';
import { EMPTY_PORTAL_CATALOG_LANGUAGE_FILTER } from '@iptvnator/portal/shared/util';

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

function createBackgroundStatus(
    overrides: Partial<MediaMetadataBackgroundStatus> = {}
): MediaMetadataBackgroundStatus {
    return {
        allowRunAfterWindowClose: true,
        failedItems: 0,
        pendingItems: 0,
        processedItems: 0,
        running: false,
        totalItems: 0,
        ...overrides,
    };
}

class MockXtreamStore {
    readonly searchTerm = signal('');
    readonly searchFilters = signal(DEFAULT_SEARCH_FILTERS);
    readonly searchResults = signal<XtreamContentItem[]>([]);
    readonly languageFilter = signal(EMPTY_PORTAL_CATALOG_LANGUAGE_FILTER);
    readonly languageFilterOptions = signal([
        { code: 'it', label: 'Italiano' },
    ]);
    readonly languageFilterActive = signal(false);
    readonly videoQualityFilter = signal<'all' | '2160p' | 'unknown'>('all');
    readonly videoQualityFilterOptions = signal([
        { value: '2160p' as const, label: '2160p+', count: 1 },
        { value: 'unknown' as const, label: 'Not detected', count: 1 },
    ]);
    readonly videoQualityFilterActive = signal(false);
    readonly metadataFiltersReady = signal(true);
    readonly filteredSearchResults = () =>
        this.searchResults().filter((item) => {
            if (!this.metadataFiltersReady()) {
                return true;
            }

            if (
                this.languageFilterActive() &&
                !matchesXtreamLanguageFilter(item, this.languageFilter())
            ) {
                return false;
            }

            if (
                this.videoQualityFilterActive() &&
                !matchesXtreamVideoQualityFilter(
                    item,
                    this.videoQualityFilter()
                )
            ) {
                return false;
            }

            return true;
        });
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
    setVideoQualityFilter = jest.fn((filter: 'all' | '2160p' | 'unknown') => {
        this.videoQualityFilter.set(filter);
        this.videoQualityFilterActive.set(filter !== 'all');
    });
    resetVideoQualityFilter = jest.fn(() => {
        this.videoQualityFilter.set('all');
        this.videoQualityFilterActive.set(false);
    });
    setSelectedContentType = jest.fn();
    playlistId = jest.fn(() => 'playlist-1');
}

describe('SearchResultsComponent initialQuery contract', () => {
    let routerNavigateMock: jest.Mock;
    let originalElectron: unknown;

    beforeEach(() => {
        routerNavigateMock = jest.fn();
        originalElectron = (window as unknown as { electron?: unknown })
            .electron;
        (window as unknown as { electron?: unknown }).electron = undefined;

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

    afterEach(() => {
        (window as unknown as { electron?: unknown }).electron =
            originalElectron;
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

    it('keeps language-filtered-out results in a separate search section', () => {
        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: false,
                    },
                    undefined
                )
        );
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        const italianMovie = createSearchItem({
            id: 1,
            xtream_id: 101,
            title: 'Italian movie',
            audioLanguages: ['it'],
        });
        const englishMovie = createSearchItem({
            id: 2,
            xtream_id: 102,
            title: 'English movie',
            audioLanguages: ['en'],
        });

        store.searchResults.set([italianMovie, englishMovie]);
        store.languageFilter.set({
            audioInclude: ['it'],
            audioExclude: [],
            subtitleInclude: [],
            subtitleExclude: [],
        });
        store.languageFilterActive.set(true);

        const sections = component.resultSections();

        expect(sections.map((section) => section.key)).toEqual([
            'visible',
            'filter-excluded',
        ]);
        expect(sections[0].items).toEqual([italianMovie]);
        expect(sections[1].items).toEqual([englishMovie]);
    });

    it('keeps quality-filtered-out results in the same filter-excluded search section', () => {
        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: false,
                    },
                    undefined
                )
        );
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        const uhdMovie = createSearchItem({
            id: 1,
            xtream_id: 101,
            title: 'UHD movie 2160p',
            mediaMetadata: {
                available: true,
                height: 2160,
                audioLanguages: [],
                audioCodecs: [],
                subtitleLanguages: [],
                subtitleCodecs: [],
            },
        });
        const unknownMovie = createSearchItem({
            id: 2,
            xtream_id: 102,
            title: 'Unknown quality movie',
        });

        store.searchResults.set([uhdMovie, unknownMovie]);
        store.videoQualityFilter.set('2160p');
        store.videoQualityFilterActive.set(true);

        const sections = component.resultSections();

        expect(sections.map((section) => section.key)).toEqual([
            'visible',
            'filter-excluded',
        ]);
        expect(sections[0].items).toEqual([uhdMovie]);
        expect(sections[1].items).toEqual([unknownMovie]);
    });

    it('does not apply metadata filters to search results until the shared metadata index is ready', () => {
        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: false,
                    },
                    undefined
                )
        );
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        const uhdMovie = createSearchItem({
            id: 1,
            xtream_id: 101,
            title: 'UHD movie 2160p',
            mediaMetadata: {
                available: true,
                height: 2160,
                audioLanguages: ['en'],
                audioCodecs: [],
                subtitleLanguages: [],
                subtitleCodecs: [],
            },
        });
        const italianMovie = createSearchItem({
            id: 2,
            xtream_id: 102,
            title: 'Italian movie',
            audioLanguages: ['it'],
        });

        store.searchResults.set([uhdMovie, italianMovie]);
        store.languageFilter.set({
            audioInclude: ['en'],
            audioExclude: [],
            subtitleInclude: [],
            subtitleExclude: [],
        });
        store.languageFilterActive.set(true);
        store.videoQualityFilter.set('2160p');
        store.videoQualityFilterActive.set(true);
        store.metadataFiltersReady.set(false);

        expect(component.resultSections()[0].items).toEqual([
            uhdMovie,
            italianMovie,
        ]);

        store.metadataFiltersReady.set(true);

        expect(component.resultSections()[0].items).toEqual([uhdMovie]);
    });

    it('forwards search quality filter changes to the shared Xtream store', () => {
        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: false,
                    },
                    undefined
                )
        );
        const store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;

        component.setVideoQualityFilter('2160p');
        component.resetVideoQualityFilter();

        expect(store.setVideoQualityFilter).toHaveBeenCalledWith('2160p');
        expect(store.resetVideoQualityFilter).toHaveBeenCalled();
    });

    it('advances the search filter progress bar with the metadata background process', async () => {
        let metadataEventHandler: ((event: unknown) => void) | undefined;
        (
            window as unknown as { electron?: Partial<Window['electron']> }
        ).electron = {
            getMediaMetadataBackgroundStatus: jest.fn().mockResolvedValue(
                createBackgroundStatus({
                    pendingItems: 8,
                    processedItems: 2,
                    running: true,
                    totalItems: 10,
                })
            ),
            onMediaMetadataBackgroundEvent: jest.fn((handler) => {
                metadataEventHandler = handler;
                return jest.fn();
            }),
        };
        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: false,
                    },
                    undefined
                )
        );

        await Promise.resolve();

        expect(component.filterIndexProgress()).toMatchObject({
            status: 'running',
            processedItems: 2,
            totalItems: 10,
            percent: 20,
        });

        metadataEventHandler?.({
            type: 'status',
            status: createBackgroundStatus({
                pendingItems: 5,
                processedItems: 5,
                running: true,
                totalItems: 10,
            }),
        });

        expect(component.filterIndexProgress()).toMatchObject({
            status: 'running',
            processedItems: 5,
            totalItems: 10,
            percent: 50,
        });
    });

    it('only exposes include language filter sections', () => {
        const component = TestBed.runInInjectionContext(
            () =>
                new SearchResultsComponent(
                    {
                        isGlobalSearch: false,
                    },
                    undefined
                )
        );

        expect(
            component.languageFilterSections.map((section) => section.key)
        ).toEqual(['audioInclude', 'subtitleInclude']);
    });
});
