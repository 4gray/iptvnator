import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { DatabaseService } from 'services';
import { SearchResultsComponent } from './search-results.component';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';

class MockXtreamStore {
    readonly searchTerm = signal('');
    readonly searchFilters = signal({
        live: true,
        movie: true,
        series: true,
    });
    readonly searchResults = signal<any[]>([]);
    readonly isSearching = signal(false);

    setSearchTerm = jest.fn((term: string) => {
        this.searchTerm.set(term);
    });
    setSearchFilters = jest.fn((filters: any) => {
        this.searchFilters.set(filters);
    });
    updateSearchFilter = jest.fn();
    setGlobalSearchResults = jest.fn((items: any[]) => {
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
                    undefined as any
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
                    undefined as any
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
                    undefined as any
                )
        );

        component.selectItem({
            playlist_id: 'playlist-1',
            type: 'movie',
            category_id: 123,
            xtream_id: 456,
        } as any);

        expect(routerNavigateMock).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            'playlist-1',
            'vod',
            123,
            456,
        ]);
    });
});
