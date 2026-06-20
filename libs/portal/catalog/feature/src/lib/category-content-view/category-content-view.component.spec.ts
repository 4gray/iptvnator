import { Component, input, output, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ReplaySubject, of } from 'rxjs';
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
    readonly items = input<unknown[]>();
    readonly pageIndex = input<number>();
    readonly totalPages = input<number>();
    readonly limit = input<number>();
    readonly pageSizeOptions = input<number[]>();
    readonly showPaginator = input(true);
    readonly searchTerm = input<string>('');
    readonly itemClicked = output<unknown>();
    readonly pageChange = output<unknown>();
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
class MockDetailComponent {}

describe('CategoryContentViewComponent', () => {
    let fixture: ComponentFixture<CategoryContentViewComponent>;
    let router: { navigate: jest.Mock };
    const paramMap$ = new ReplaySubject(1);
    const queryParamMap$ = new ReplaySubject(1);
    const isPaginatedContentLoading = signal(true);
    const categoryItemCount = signal(0);
    const contentSortMode = signal<PortalCatalogSortMode | null>(null);
    const minRating = signal<number | null>(null);
    const catalog = {
        provider: 'xtream' as const,
        pageSizeOptions: [10, 25, 50],
        contentType: signal('vod'),
        limit: signal(25),
        pageIndex: signal(0),
        selectedCategory: signal({ id: 1 }),
        paginatedContent: signal<unknown[]>([]),
        selectedCategoryTitle: signal('Movies'),
        categoryItemCount,
        selectedItem: signal(null),
        totalPages: signal(0),
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
        setContentSortMode: jest.fn(),
        setMinRating: jest.fn(),
        selectItem: jest.fn().mockReturnValue(null),
        getItemProgress: jest.fn().mockReturnValue({}),
    };

    beforeEach(async () => {
        isPaginatedContentLoading.set(true);
        categoryItemCount.set(0);
        contentSortMode.set(null);
        catalog.supportsRatingSort = true;
        minRating.set(null);
        catalog.initialize.mockClear();
        catalog.setSearchQuery.mockClear();
        catalog.setPage.mockClear();
        catalog.setLimit.mockClear();
        catalog.setContentSortMode.mockClear();
        catalog.setMinRating.mockClear();
        catalog.selectItem.mockClear();
        catalog.selectItem.mockReturnValue(null);
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
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
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
        expect(
            fixture.nativeElement.querySelector('.sort-action')
        ).toBeNull();
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
            ratingChip?.querySelector('.refinement-chip-label-full')?.textContent
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
});
