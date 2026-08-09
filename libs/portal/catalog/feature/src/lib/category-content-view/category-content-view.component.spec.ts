import { Component, input, output, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { EMPTY, ReplaySubject, of } from 'rxjs';
import { InfiniteScrollDirective } from '@iptvnator/portal/shared/ui';
import {
    PORTAL_CATALOG_DETAIL_COMPONENT,
    PORTAL_CATALOG_FACADE,
    PortalCatalogSortMode,
} from '@iptvnator/portal/shared/util';
import { CategoryContentViewComponent } from './category-content-view.component';

@Component({
    selector: 'app-grid-list',
    standalone: true,
    template: '',
})
class MockGridListComponent {
    readonly isLoading = input<boolean>();
    readonly isAppending = input<boolean>();
    readonly appendError = input<boolean>();
    readonly items = input<unknown[]>();
    readonly searchTerm = input<string>('');
    readonly type = input<string>('');
    readonly itemClicked = output<unknown>();
    readonly retryLoadMore = output<void>();
}

@Component({
    selector: 'app-playlist-error-view',
    standalone: true,
    template: '',
})
class MockPlaylistErrorViewComponent {
    readonly title = input('');
    readonly description = input('');
    readonly showActionButtons = input(true);
    readonly viewType = input('');
}

@Component({
    standalone: true,
    template: '',
})
class MockDetailComponent {
    readonly providerOnly = input(false);
}

describe('CategoryContentViewComponent', () => {
    let fixture: ComponentFixture<CategoryContentViewComponent>;
    let router: { navigate: jest.Mock };
    const paramMap$ = new ReplaySubject(1);
    const queryParamMap$ = new ReplaySubject(1);
    const isPaginatedContentLoading = signal(true);
    const categoryItemCount = signal(0);
    const contentSortMode = signal<PortalCatalogSortMode | null>(null);
    const minRating = signal<number | null>(null);
    const selectedItem = signal<Record<string, unknown> | null>(null);
    const hasMore = signal(false);
    const isAppending = signal(false);
    const appendError = signal(false);
    const catalog = {
        provider: 'xtream' as 'xtream' | 'stalker',
        supportsInfiniteScroll: false as boolean,
        pageSizeOptions: [10, 25, 50],
        contentType: signal('vod'),
        limit: signal(25),
        pageIndex: signal(0),
        selectedCategory: signal({ id: 1 }),
        paginatedContent: signal<unknown[]>([]),
        selectedCategoryTitle: signal('Movies'),
        categoryItemCount,
        selectedItem,
        totalPages: signal(0),
        hasMore,
        isAppending,
        appendError,
        contentSortMode,
        supportsRatingSort: true,
        minRating,
        playlist: signal(null),
        isPaginatedContentLoading,
        initialize: jest.fn(),
        setSearchQuery: jest.fn(),
        clearSelectedItem: jest.fn(),
        setPage: jest.fn(),
        setLimit: jest.fn(),
        loadMore: jest.fn(),
        retryAppend: jest.fn(),
        saveScrollPosition: jest.fn(),
        consumeSavedScrollPosition: jest.fn().mockReturnValue(null),
        setContentSortMode: jest.fn(),
        setMinRating: jest.fn(),
        selectItem: jest.fn().mockReturnValue(null),
        refreshSnapshotSelection: jest.fn(),
        getItemProgress: jest.fn().mockReturnValue({}),
    };

    beforeEach(async () => {
        window.history.replaceState({}, '', window.location.href);
        catalog.provider = 'xtream';
        catalog.supportsInfiniteScroll = false;
        selectedItem.set(null);
        isPaginatedContentLoading.set(true);
        categoryItemCount.set(0);
        contentSortMode.set(null);
        catalog.supportsRatingSort = true;
        minRating.set(null);
        hasMore.set(false);
        isAppending.set(false);
        appendError.set(false);
        catalog.initialize.mockClear();
        catalog.setSearchQuery.mockClear();
        catalog.setPage.mockClear();
        catalog.setLimit.mockClear();
        catalog.loadMore.mockClear();
        catalog.retryAppend.mockClear();
        catalog.saveScrollPosition.mockClear();
        catalog.consumeSavedScrollPosition.mockClear();
        catalog.consumeSavedScrollPosition.mockReturnValue(null);
        catalog.setContentSortMode.mockClear();
        catalog.setMinRating.mockClear();
        catalog.selectItem.mockClear();
        catalog.selectItem.mockReturnValue(null);
        catalog.refreshSnapshotSelection.mockClear();
        router = {
            navigate: jest.fn(),
        };
        paramMap$.next(convertToParamMap({}));
        queryParamMap$.next(convertToParamMap({}));

        await TestBed.configureTestingModule({
            imports: [CategoryContentViewComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) =>
                            key === 'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
                                ? 'Fetching playlist data from source...'
                                : key,
                        get: (key: string) =>
                            of(
                                key === 'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
                                    ? 'Fetching playlist data from source...'
                                    : key
                            ),
                        stream: (key: string) =>
                            of(
                                key === 'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
                                    ? 'Fetching playlist data from source...'
                                    : key
                            ),
                        onLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                        onDefaultLangChange: EMPTY,
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                {
                    provide: PORTAL_CATALOG_FACADE,
                    useValue: catalog,
                },
                {
                    provide: PORTAL_CATALOG_DETAIL_COMPONENT,
                    useValue: MockDetailComponent,
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        paramMap: paramMap$.asObservable(),
                        queryParamMap: queryParamMap$.asObservable(),
                        snapshot: {
                            params: {},
                        },
                    },
                },
                {
                    provide: Router,
                    useValue: router,
                },
            ],
        })
            .overrideComponent(CategoryContentViewComponent, {
                set: {
                    imports: [
                        NgComponentOutlet,
                        InfiniteScrollDirective,
                        MockGridListComponent,
                        MockPlaylistErrorViewComponent,
                        MatIcon,
                        MatButtonModule,
                        MatMenuModule,
                        MatPaginatorModule,
                        MatTooltip,
                        TranslatePipe,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(CategoryContentViewComponent);
    });

    afterEach(() => {
        window.history.replaceState({}, '', window.location.href);
    });

    it('shows loading copy in the subtitle instead of 0 items while xtream content is still warming up', () => {
        fixture.detectChanges();

        const subtitle = fixture.nativeElement.querySelector(
            '.category-subtitle'
        ) as HTMLElement | null;

        expect(catalog.initialize).toHaveBeenCalledWith(null);
        expect(subtitle?.textContent?.trim()).toBe(
            'Fetching playlist data from source...'
        );
    });

    it('forwards query-param search updates to the catalog facade when supported', () => {
        fixture.detectChanges();
        catalog.setSearchQuery.mockClear();

        queryParamMap$.next(
            convertToParamMap({
                q: 'matrix',
            })
        );

        expect(catalog.setSearchQuery).toHaveBeenCalledWith('matrix');
    });

    it('groups catalog sort and rating filters behind one refine menu trigger', () => {
        contentSortMode.set('date-desc');
        categoryItemCount.set(12);

        fixture.detectChanges();

        const refineButton = fixture.nativeElement.querySelector(
            '.refine-action'
        ) as HTMLButtonElement | null;
        const sortChip = fixture.nativeElement.querySelector(
            '.sort-refinement-chip'
        ) as HTMLElement | null;

        expect(refineButton).not.toBeNull();
        expect(sortChip).not.toBeNull();
        expect(sortChip?.tagName).not.toBe('BUTTON');
        expect(fixture.nativeElement.querySelector('.sort-action')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.rating-filter-action')
        ).toBeNull();

        refineButton?.click();
        fixture.detectChanges();

        const overlayText = document.body.textContent ?? '';
        expect(overlayText).toContain('WORKSPACE.REFINE_SORT_SECTION');
        expect(overlayText).toContain('WORKSPACE.SORT_DATE_DESC');
        expect(overlayText).toContain('WORKSPACE.REFINE_RATING_SECTION');
        expect(overlayText).toContain('WORKSPACE.FILTER_RATING_ANY');
    });

    it('shows active sort and rating chips and lets the rating chip clear the threshold', () => {
        contentSortMode.set('rating-desc');
        minRating.set(8);
        categoryItemCount.set(12);

        fixture.detectChanges();

        const sortChip = fixture.nativeElement.querySelector(
            '.sort-refinement-chip'
        ) as HTMLElement | null;
        const ratingChip = fixture.nativeElement.querySelector(
            '.rating-refinement-chip'
        ) as HTMLButtonElement | null;

        expect(sortChip?.textContent).toContain('WORKSPACE.SORT_TOP_RATED');
        expect(ratingChip?.textContent).toContain('8');

        ratingChip?.click();

        expect(catalog.setMinRating).toHaveBeenCalledWith(null);
    });

    it('hides rating refinements when the catalog facade does not support rating sorting', () => {
        catalog.supportsRatingSort = false;
        contentSortMode.set('date-desc');
        minRating.set(9);
        categoryItemCount.set(12);

        fixture.detectChanges();

        expect(fixture.componentInstance.supportsRatingSort()).toBe(false);
        expect(fixture.componentInstance.canFilterByRating()).toBe(false);
        expect(fixture.componentInstance.minRating()).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.rating-refinement-chip')
        ).toBeNull();
    });

    it('renders full and compact refinement chip labels for responsive layouts', () => {
        contentSortMode.set('name-asc');
        minRating.set(9);
        categoryItemCount.set(12);

        fixture.detectChanges();

        const sortChip = fixture.nativeElement.querySelector(
            '.sort-refinement-chip'
        ) as HTMLElement | null;
        const ratingChip = fixture.nativeElement.querySelector(
            '.rating-refinement-chip'
        ) as HTMLElement | null;

        expect(
            sortChip?.querySelector('.refinement-chip-label-full')?.textContent
        ).toContain('WORKSPACE.SORT_LABEL');
        expect(
            sortChip?.querySelector('.refinement-chip-label-compact')
                ?.textContent
        ).toContain('WORKSPACE.SORT_NAME_ASC');
        expect(
            ratingChip?.querySelector('.refinement-chip-label-full')
                ?.textContent
        ).toContain('WORKSPACE.FILTER_RATING');
        expect(
            ratingChip?.querySelector('.refinement-chip-label-compact')
                ?.textContent
        ).toContain('9.0+');
    });

    it('restores the zero-based catalog page from the one-based page query param', () => {
        fixture.detectChanges();
        catalog.setPage.mockClear();

        queryParamMap$.next(
            convertToParamMap({
                page: '3',
            })
        );

        expect(catalog.setPage).toHaveBeenCalledWith(2);
    });

    it('preserves the initial search and page query params on direct route loads', () => {
        queryParamMap$.next(
            convertToParamMap({
                q: 'matrix',
                page: '3',
            })
        );

        fixture.detectChanges();

        expect(catalog.setSearchQuery).toHaveBeenCalledWith('matrix');
        expect(catalog.setPage).toHaveBeenCalledWith(2);
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('resets to the first page and removes stale page query params when search changes', () => {
        fixture.detectChanges();
        catalog.setPage.mockClear();

        queryParamMap$.next(
            convertToParamMap({
                q: 'matrix',
                page: '3',
            })
        );

        expect(catalog.setSearchQuery).toHaveBeenCalledWith('matrix');
        expect(catalog.setPage).toHaveBeenCalledWith(0);
        expect(router.navigate).toHaveBeenCalledWith([], {
            relativeTo: expect.any(Object),
            queryParams: {
                page: null,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    });

    it('restores page changes while the search query is unchanged', () => {
        queryParamMap$.next(
            convertToParamMap({
                q: 'matrix',
            })
        );
        fixture.detectChanges();
        catalog.setPage.mockClear();

        queryParamMap$.next(
            convertToParamMap({
                q: 'matrix',
                page: '3',
            })
        );

        expect(catalog.setPage).toHaveBeenCalledWith(2);
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('falls back to the first catalog page when the page query param is absent or invalid', () => {
        fixture.detectChanges();
        catalog.setPage.mockClear();

        queryParamMap$.next(convertToParamMap({}));
        queryParamMap$.next(
            convertToParamMap({
                page: 'not-a-page',
            })
        );

        expect(catalog.setPage).toHaveBeenNthCalledWith(1, 0);
        expect(catalog.setPage).toHaveBeenNthCalledWith(2, 0);
    });

    it('writes one-based page query params when the paginator changes', () => {
        fixture.detectChanges();

        fixture.componentInstance.onPageChange({
            length: 100,
            pageIndex: 1,
            pageSize: 25,
            previousPageIndex: 0,
        });

        expect(catalog.setPage).toHaveBeenCalledWith(1);
        expect(catalog.setLimit).toHaveBeenCalledWith(25);
        expect(router.navigate).toHaveBeenCalledWith([], {
            relativeTo: expect.any(Object),
            queryParams: {
                page: 2,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    });

    it('removes the page query param when returning to the first page', () => {
        fixture.detectChanges();

        fixture.componentInstance.onPageChange({
            length: 100,
            pageIndex: 0,
            pageSize: 25,
            previousPageIndex: 1,
        });

        expect(router.navigate).toHaveBeenCalledWith([], {
            relativeTo: expect.any(Object),
            queryParams: {
                page: null,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    });

    it('scrolls the grid list host to the top when the paginator changes', () => {
        fixture.detectChanges();
        const gridList = fixture.nativeElement.querySelector(
            'app-grid-list'
        ) as HTMLElement;
        const scrollTo = jest.fn();
        Object.defineProperty(gridList, 'scrollTo', {
            configurable: true,
            value: scrollTo,
        });

        fixture.componentInstance.onPageChange({
            length: 100,
            pageIndex: 1,
            pageSize: 25,
            previousPageIndex: 0,
        });

        expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    });

    it('preserves query params when navigating from an item to Xtream details', () => {
        catalog.selectItem.mockReturnValue(['42']);
        fixture.detectChanges();

        fixture.componentInstance.onItemClick({
            xtream_id: 42,
        });

        expect(router.navigate).toHaveBeenCalledWith(['42'], {
            relativeTo: expect.any(Object),
            queryParamsHandling: 'preserve',
        });
    });

    it('hands provider-only presentation to the exact Stalker item after consuming navigation state', async () => {
        const item = { id: '42', category_id: 'vod' };
        catalog.provider = 'stalker';
        catalog.selectItem.mockImplementation((selected) => {
            selectedItem.set(selected);
            return null;
        });
        window.history.replaceState(
            {
                detailPresentation: 'provider-only',
                openStalkerItem: item,
                preserved: 'value',
            },
            '',
            window.location.href
        );

        fixture.detectChanges();
        await fixture.whenStable();

        const detail = fixture.debugElement.query(
            By.directive(MockDetailComponent)
        ).componentInstance as MockDetailComponent;
        expect(catalog.selectItem).toHaveBeenCalledWith(item);
        expect(catalog.refreshSnapshotSelection).toHaveBeenCalled();
        expect(detail.providerOnly()).toBe(true);
        expect(window.history.state).toEqual({ preserved: 'value' });
    });

    it('does not retain the consumed provider-only presentation across identity, regular-open, or route changes', async () => {
        const item = { id: '42', category_id: 'vod' };
        catalog.provider = 'stalker';
        catalog.selectItem.mockImplementation((selected) => {
            selectedItem.set(selected);
            return null;
        });
        window.history.replaceState(
            {
                detailPresentation: 'provider-only',
                openStalkerItem: item,
            },
            '',
            window.location.href
        );
        fixture.detectChanges();
        await fixture.whenStable();

        selectedItem.set({ id: '99', category_id: 'vod' });
        await fixture.whenStable();
        let detail = fixture.debugElement.query(
            By.directive(MockDetailComponent)
        ).componentInstance as MockDetailComponent;
        expect(detail.providerOnly()).toBe(false);

        fixture.componentInstance.onItemClick(item);
        await fixture.whenStable();
        detail = fixture.debugElement.query(By.directive(MockDetailComponent))
            .componentInstance as MockDetailComponent;
        expect(detail.providerOnly()).toBe(false);

        window.history.replaceState({}, '', window.location.href);
        paramMap$.next(convertToParamMap({ categoryId: 'another-category' }));
        selectedItem.set(item);
        await fixture.whenStable();
        detail = fixture.debugElement.query(By.directive(MockDetailComponent))
            .componentInstance as MockDetailComponent;
        expect(detail.providerOnly()).toBe(false);
    });

    describe('infinite scroll mode', () => {
        let rafCallbacks: FrameRequestCallback[];

        beforeEach(() => {
            rafCallbacks = [];
            jest.spyOn(window, 'requestAnimationFrame').mockImplementation(
                (callback: FrameRequestCallback) => {
                    rafCallbacks.push(callback);
                    return rafCallbacks.length;
                }
            );
            jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(
                () => undefined
            );
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        function createInfiniteFixture(): ComponentFixture<CategoryContentViewComponent> {
            // The outer paged fixture shares ApplicationRef: an app-wide tick
            // would run its ngOnInit and let it consume the same query params.
            fixture.destroy();
            catalog.supportsInfiniteScroll = true;
            isPaginatedContentLoading.set(false);
            return TestBed.createComponent(CategoryContentViewComponent);
        }

        function flushAnimationFrames(): void {
            while (rafCallbacks.length) {
                const callback = rafCallbacks.shift();
                callback?.(0);
            }
        }

        it('renders no paginator and delegates loadMore to the facade', () => {
            const infiniteFixture = createInfiniteFixture();
            categoryItemCount.set(12);
            catalog.paginatedContent.set([{ xtream_id: 1, title: 'A' }]);

            infiniteFixture.detectChanges();

            expect(
                infiniteFixture.nativeElement.querySelector('mat-paginator')
            ).toBeNull();

            infiniteFixture.componentInstance.onLoadMore();
            expect(catalog.loadMore).toHaveBeenCalledTimes(1);
        });

        it('strips a stale page query param instead of paging', () => {
            const infiniteFixture = createInfiniteFixture();
            queryParamMap$.next(convertToParamMap({ page: '3' }));

            infiniteFixture.detectChanges();

            expect(catalog.setPage).not.toHaveBeenCalled();
            expect(router.navigate).toHaveBeenCalledWith(
                [],
                expect.objectContaining({
                    queryParams: { page: null },
                    replaceUrl: true,
                })
            );
        });

        it('saves the grid scroll position before opening a detail', () => {
            const infiniteFixture = createInfiniteFixture();
            infiniteFixture.detectChanges();
            const grid = infiniteFixture.nativeElement.querySelector(
                'app-grid-list'
            ) as HTMLElement;
            Object.defineProperty(grid, 'scrollTop', {
                configurable: true,
                value: 333,
            });

            infiniteFixture.componentInstance.onItemClick({ xtream_id: 42 });

            expect(catalog.saveScrollPosition).toHaveBeenCalledWith(333);
        });

        it('consumes a saved scroll position once the list is rendered', () => {
            catalog.consumeSavedScrollPosition.mockReturnValue(500);
            const infiniteFixture = createInfiniteFixture();

            infiniteFixture.detectChanges();

            expect(catalog.consumeSavedScrollPosition).toHaveBeenCalledTimes(
                1
            );

            const grid = infiniteFixture.nativeElement.querySelector(
                'app-grid-list'
            ) as HTMLElement;
            const scrollTo = jest.fn();
            Object.defineProperty(grid, 'scrollTo', {
                configurable: true,
                value: scrollTo,
            });

            flushAnimationFrames();

            expect(scrollTo).toHaveBeenCalledWith({ top: 500 });
        });

        it('scrolls the grid to the top when the reset key changes', () => {
            const infiniteFixture = createInfiniteFixture();
            contentSortMode.set('date-desc');
            infiniteFixture.detectChanges();

            const grid = infiniteFixture.nativeElement.querySelector(
                'app-grid-list'
            ) as HTMLElement;
            const scrollTo = jest.fn();
            Object.defineProperty(grid, 'scrollTo', {
                configurable: true,
                value: scrollTo,
            });

            contentSortMode.set('name-asc');
            infiniteFixture.detectChanges();

            expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
        });
    });
});
