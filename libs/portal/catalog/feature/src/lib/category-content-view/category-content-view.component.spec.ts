import { Component, input, output, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
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
        contentType: signal('vod'),
        selectedCategory: signal({ id: 1 }),
        paginatedContent: signal<unknown[]>([]),
        selectedCategoryTitle: signal('Movies'),
        categoryItemCount,
        selectedItem,
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

    it('retires a return marker that outlived its handoff item', async () => {
        // Leaving the entry with the browser's own Back never runs a back
        // affordance, so nothing retired the contract; a Forward replay lands
        // here with the marker but no handoff item and no open detail.
        catalog.provider = 'stalker';
        window.history.replaceState(
            {
                stalkerReturnTo: '/workspace/global-favorites',
                stalkerReturnByHistory: '42',
                preserved: 'value',
            },
            '',
            window.location.href
        );

        fixture.detectChanges();
        await fixture.whenStable();

        expect(window.history.state).toEqual({ preserved: 'value' });
    });

    it('keeps the return marker while the handoff detail is being opened', async () => {
        const item = { id: '42', category_id: 'vod' };
        catalog.provider = 'stalker';
        catalog.selectItem.mockImplementation((selected) => {
            selectedItem.set(selected);
            return null;
        });
        window.history.replaceState(
            {
                openStalkerItem: item,
                stalkerReturnTo: '/workspace/global-favorites',
                stalkerReturnByHistory: '42',
            },
            '',
            window.location.href
        );

        fixture.detectChanges();
        await fixture.whenStable();

        // The contract must survive arrival — the back affordance consumes it.
        expect(window.history.state).toEqual({
            stalkerReturnTo: '/workspace/global-favorites',
            stalkerReturnByHistory: '42',
        });
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
            // The outer fixture shares ApplicationRef: an app-wide tick would
            // run its ngOnInit and let it consume the same query params.
            fixture.destroy();
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

            expect(catalog.consumeSavedScrollPosition).toHaveBeenCalledTimes(1);

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
