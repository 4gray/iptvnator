import {
    Component,
    input,
    output,
    signal,
    ChangeDetectionStrategy,
} from '@angular/core';
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
    MenuItemRadioCheckDirective,
    MenuItemRadioDirective,
} from '@iptvnator/ui/components';
import {
    PORTAL_CATALOG_DETAIL_COMPONENT,
    PORTAL_CATALOG_FACADE,
    PortalCatalogSortMode,
} from '@iptvnator/portal/shared/util';
import { CategoryContentViewComponent } from './category-content-view.component';

@Component({
    selector: 'app-grid-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.Eager,
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
    changeDetection: ChangeDetectionStrategy.Eager,
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
    changeDetection: ChangeDetectionStrategy.Eager,
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
    const routeReady = signal(true);
    const playlist = signal<{ id: string } | null>(null);
    const catalog = {
        routeReady,
        provider: 'xtream' as 'xtream' | 'stalker',
        contentType: signal('vod'),
        selectedCategory: signal({ id: 1 }),
        paginatedContent: signal<unknown[]>([]),
        selectedCategoryTitle: signal<string | null>('Movies'),
        categoryItemCount,
        selectedItem,
        hasMore,
        isAppending,
        appendError,
        contentSortMode,
        supportsRatingSort: true,
        minRating,
        playlist,
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
        routeReady.set(true);
        playlist.set(null);
        catalog.selectedCategoryTitle.set('Movies');
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
                        MenuItemRadioCheckDirective,
                        MenuItemRadioDirective,
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

    it('titles the every-item grid with the translated label', () => {
        catalog.selectedCategoryTitle.set(null);
        fixture.detectChanges();

        const title = fixture.nativeElement.querySelector(
            '.category-title'
        ) as HTMLElement | null;

        expect(title?.textContent?.trim()).toBe('PORTALS.ALL_ITEMS');
    });

    it('counts items with the translated singular and plural keys', () => {
        isPaginatedContentLoading.set(false);
        categoryItemCount.set(1);
        fixture.detectChanges();

        const subtitle = () =>
            (
                fixture.nativeElement.querySelector(
                    '.category-subtitle'
                ) as HTMLElement | null
            )?.textContent?.trim();

        expect(subtitle()).toBe('WORKSPACE.CONTEXT.ITEM_COUNT_ONE');

        categoryItemCount.set(3);
        fixture.detectChanges();

        expect(subtitle()).toBe('WORKSPACE.CONTEXT.ITEM_COUNT_OTHER');
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

    it('preserves route search after category initialization resets the store filter', () => {
        let search = '';
        catalog.initialize.mockImplementation(() => {
            search = '';
        });
        catalog.setSearchQuery.mockImplementation((query: string) => {
            search = query;
        });
        queryParamMap$.next(convertToParamMap({ q: 'matrix' }));
        paramMap$.next(convertToParamMap({ categoryId: '5' }));
        fixture.detectChanges();
        expect(search).toBe('matrix');
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

        expect(
            sortChip
                ?.querySelector('.refinement-chip-label')
                ?.textContent?.trim()
        ).toBe('WORKSPACE.SORT_CHIP.TOP_RATED');
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

    it.each([
        ['date-desc', 'WORKSPACE.SORT_CHIP.NEWEST', 'WORKSPACE.SORT_DATE_DESC'],
        ['date-asc', 'WORKSPACE.SORT_CHIP.OLDEST', 'WORKSPACE.SORT_DATE_ASC'],
        ['name-asc', 'WORKSPACE.SORT_NAME_ASC', 'WORKSPACE.SORT_NAME_ASC'],
        ['name-desc', 'WORKSPACE.SORT_NAME_DESC', 'WORKSPACE.SORT_NAME_DESC'],
        [
            'rating-desc',
            'WORKSPACE.SORT_CHIP.TOP_RATED',
            'WORKSPACE.SORT_TOP_RATED',
        ],
        [
            'rating-asc',
            'WORKSPACE.SORT_CHIP.LOWEST_RATED',
            'WORKSPACE.SORT_LOWEST_RATED',
        ],
    ] as const)(
        'shows only the short %s label in the sort chip and reads the full label to screen readers',
        (mode, chipKey, menuKey) => {
            contentSortMode.set(mode);
            categoryItemCount.set(12);

            fixture.detectChanges();

            const sortChip = fixture.nativeElement.querySelector(
                '.sort-refinement-chip'
            ) as HTMLElement;
            const labels = sortChip.querySelectorAll('.refinement-chip-label');

            expect(labels).toHaveLength(1);
            expect(labels[0].textContent?.trim()).toBe(chipKey);
            // A generic div cannot be named, so the full text must be content
            // that screen readers read: everything outside aria-hidden.
            expect(sortChip.hasAttribute('aria-label')).toBe(false);
            expect(screenReaderText(sortChip)).toBe(
                `WORKSPACE.SORT_LABEL${menuKey}`
            );
        }
    );

    it('shows the rating threshold alone in the rating chip and names the clear action', () => {
        contentSortMode.set('name-asc');
        minRating.set(9);
        categoryItemCount.set(12);

        fixture.detectChanges();

        const ratingChip = fixture.nativeElement.querySelector(
            '.rating-refinement-chip'
        ) as HTMLElement;
        const labels = ratingChip.querySelectorAll('.refinement-chip-label');

        expect(labels).toHaveLength(1);
        expect(labels[0].textContent?.trim()).toBe('9.0+');
        expect(ratingChip.getAttribute('aria-label')).toBe(
            'WORKSPACE.REFINE_CLEAR_RATING'
        );
        // The button projects its icons around the label: star first, the
        // clear cross after the value rather than between star and value.
        const order = Array.from(
            ratingChip.querySelectorAll('mat-icon, .refinement-chip-label'),
            (element) => element.textContent?.trim()
        );
        expect(order).toEqual(['star', '9.0+', 'close']);
    });

    it('offers sort and rating choices as radio groups whose aria-checked follows the active refinement', () => {
        contentSortMode.set('name-desc');
        minRating.set(8);
        categoryItemCount.set(12);
        fixture.detectChanges();

        (
            fixture.nativeElement.querySelector(
                '.refine-action'
            ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        const groups = Array.from(
            document.querySelectorAll<HTMLElement>(
                '.refine-menu [role="group"]'
            )
        );
        const checkedLabels = (group: HTMLElement) =>
            Array.from(
                group.querySelectorAll('[role="menuitemradio"]'),
                (row) =>
                    `${row.getAttribute('aria-checked')} ${row
                        .querySelector('.mat-mdc-menu-item-text')
                        ?.textContent?.trim()}`
            );

        expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(
            ['WORKSPACE.REFINE_SORT_SECTION', 'WORKSPACE.REFINE_RATING_SECTION']
        );
        expect(checkedLabels(groups[0])).toEqual([
            'false WORKSPACE.SORT_DATE_DESC',
            'false WORKSPACE.SORT_DATE_ASC',
            'false WORKSPACE.SORT_NAME_ASC',
            'true WORKSPACE.SORT_NAME_DESC',
            'false WORKSPACE.SORT_TOP_RATED',
            'false WORKSPACE.SORT_LOWEST_RATED',
        ]);
        expect(checkedLabels(groups[1])).toEqual([
            'false WORKSPACE.FILTER_RATING_ANY',
            'false WORKSPACE.FILTER_RATING_MIN',
            'true WORKSPACE.FILTER_RATING_MIN',
            'false WORKSPACE.FILTER_RATING_MIN',
            'false WORKSPACE.FILTER_RATING_MIN',
            'false WORKSPACE.FILTER_RATING_MIN',
        ]);
        expect(
            document.querySelectorAll('.refine-menu [mat-menu-item]')
        ).toHaveLength(
            document.querySelectorAll('.refine-menu [role="menuitemradio"]')
                .length
        );
    });

    it('drops the rating sort rows when the provider cannot sort by rating', () => {
        catalog.supportsRatingSort = false;
        contentSortMode.set('date-desc');
        categoryItemCount.set(12);
        fixture.detectChanges();

        (
            fixture.nativeElement.querySelector(
                '.refine-action'
            ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        expect(
            Array.from(
                document.querySelectorAll('.refine-menu [mat-menu-item]'),
                (row) => row.getAttribute('aria-checked')
            )
        ).toEqual(['true', 'false', 'false', 'false']);
        expect(document.body.textContent).not.toContain(
            'WORKSPACE.SORT_TOP_RATED'
        );
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

    it('waits for the destination portal before initializing and consuming a Stalker handoff', () => {
        catalog.provider = 'stalker';
        routeReady.set(false);
        const item = { id: '42', name: 'Destination movie' };
        window.history.replaceState(
            { openStalkerItem: item },
            '',
            window.location.href
        );
        paramMap$.next(convertToParamMap({ categoryId: '5' }));
        fixture.detectChanges();
        expect(catalog.initialize).not.toHaveBeenCalled();
        expect(catalog.selectItem).not.toHaveBeenCalled();
        expect(window.history.state.openStalkerItem).toEqual(item);

        routeReady.set(true);
        fixture.detectChanges();
        expect(catalog.initialize).toHaveBeenCalledWith('5');
        expect(catalog.selectItem).toHaveBeenCalledWith(item);
        expect(window.history.state.openStalkerItem).toBeUndefined();

        routeReady.set(false);
        fixture.detectChanges();
        routeReady.set(true);
        fixture.detectChanges();
        expect(catalog.initialize).toHaveBeenCalledTimes(1);
    });

    it('reinitializes a reused category route when the ready playlist changes', () => {
        catalog.provider = 'stalker';
        playlist.set({ id: 'a' });
        paramMap$.next(convertToParamMap({ categoryId: '5' }));
        fixture.detectChanges();
        routeReady.set(false);
        fixture.detectChanges();
        const item = { id: '42', name: 'Movie from B' };
        window.history.replaceState(
            { openStalkerItem: item },
            '',
            window.location.href
        );
        playlist.set({ id: 'b' });
        fixture.detectChanges();
        expect(catalog.initialize).toHaveBeenCalledTimes(1);
        routeReady.set(true);
        fixture.detectChanges();
        expect(catalog.initialize).toHaveBeenCalledTimes(2);
        expect(catalog.selectItem).toHaveBeenCalledWith(item);
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

    it('leaves a plain stalkerReturnTo handoff alone', async () => {
        // The dashboard handoff sets no history-back marker and keeps its
        // pre-existing re-navigating behaviour.
        catalog.provider = 'stalker';
        window.history.replaceState(
            { stalkerReturnTo: '/workspace/dashboard' },
            '',
            window.location.href
        );

        fixture.detectChanges();
        await fixture.whenStable();

        expect(window.history.state).toEqual({
            stalkerReturnTo: '/workspace/dashboard',
        });
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

/** Text a screen reader reads from `element`: content outside aria-hidden. */
function screenReaderText(element: Element): string {
    return Array.from(element.childNodes, (node): string => {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent ?? '';
        }
        return node instanceof Element &&
            node.getAttribute('aria-hidden') !== 'true'
            ? screenReaderText(node)
            : '';
    })
        .join('')
        .trim();
}
