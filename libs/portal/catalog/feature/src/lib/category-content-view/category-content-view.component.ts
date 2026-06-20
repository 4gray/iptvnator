import { NgComponentOutlet } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    ElementRef,
    inject,
    OnInit,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    GridListComponent,
    PlaylistErrorViewComponent,
} from '@iptvnator/portal/shared/ui';
import {
    clearNavigationStateKeys,
    getOpenStalkerItemState,
    PortalCatalogFacade,
    OPEN_STALKER_ITEM_STATE_KEY,
    PORTAL_CATALOG_DETAIL_COMPONENT,
    PORTAL_CATALOG_FACADE,
    PortalCatalogSortMode,
} from '@iptvnator/portal/shared/util';

interface CategoryContentItem {
    id?: number | string;
    is_series?: number | string | boolean;
    xtream_id?: number | string;
    series_id?: number | string;
    stream_id?: number | string;
    category_id?: number | string;
    [key: string]: unknown;
}

@Component({
    selector: 'app-category-content-view',
    templateUrl: './category-content-view.component.html',
    styleUrls: ['./category-content-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        GridListComponent,
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        MatPaginatorModule,
        MatTooltip,
        NgComponentOutlet,
        PlaylistErrorViewComponent,
        TranslatePipe,
    ],
})
export class CategoryContentViewComponent implements OnInit {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly destroyRef = inject(DestroyRef);
    private readonly hostElement = inject(ElementRef<HTMLElement>);
    private readonly router = inject(Router);
    private readonly translate = inject(TranslateService);
    private hasAppliedInitialQueryParams = false;
    private previousSearchQuery: string | null = null;
    private readonly catalog = inject(
        PORTAL_CATALOG_FACADE
    ) as PortalCatalogFacade<
        CategoryContentItem,
        CategoryContentItem,
        CategoryContentItem
    >;

    readonly detailComponent = inject(PORTAL_CATALOG_DETAIL_COMPONENT);
    readonly contentType = this.catalog.contentType;
    readonly limit = this.catalog.limit;
    readonly pageIndex = this.catalog.pageIndex;
    readonly pageSizeOptions = Array.from(this.catalog.pageSizeOptions);
    readonly selectedCategory = this.catalog.selectedCategory;
    readonly paginatedContent = this.catalog.paginatedContent;
    readonly selectedCategoryTitle = this.catalog.selectedCategoryTitle;
    readonly categoryItemCount = this.catalog.categoryItemCount;
    readonly selectedItem = this.catalog.selectedItem;
    readonly totalPages = this.catalog.totalPages;
    readonly contentSortMode = this.catalog.contentSortMode;
    readonly isPaginatedContentLoading = this.catalog.isPaginatedContentLoading;
    readonly isXtreamLoadingSubtitle = computed(
        () =>
            this.catalog.provider === 'xtream' &&
            this.isPaginatedContentLoading()
    );
    readonly categoryItemSubtitle = computed(() => {
        if (this.isXtreamLoadingSubtitle()) {
            return this.translate.instant(
                'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
            );
        }

        const itemCount = this.categoryItemCount();
        return `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
    });
    readonly canSortContent = computed(() => this.contentSortMode() !== null);
    readonly supportsRatingSort = computed(
        () => this.catalog.supportsRatingSort === true
    );
    readonly canFilterByRating = computed(
        () =>
            this.supportsRatingSort() &&
            typeof this.catalog.setMinRating === 'function'
    );
    readonly minRating = computed(() =>
        this.canFilterByRating() ? (this.catalog.minRating?.() ?? null) : null
    );
    readonly ratingThresholds = [9, 8, 7, 6, 5] as const;
    readonly hasRefineControls = computed(
        () => this.canSortContent() || this.canFilterByRating()
    );
    readonly activeRefinementCount = computed(() =>
        this.minRating() !== null ? 1 : 0
    );
    readonly activeSortLabelKey = computed(() => {
        switch (this.contentSortMode()) {
            case 'date-desc':
                return 'WORKSPACE.SORT_DATE_DESC';
            case 'date-asc':
                return 'WORKSPACE.SORT_DATE_ASC';
            case 'name-asc':
                return 'WORKSPACE.SORT_NAME_ASC';
            case 'name-desc':
                return 'WORKSPACE.SORT_NAME_DESC';
            case 'rating-desc':
                return 'WORKSPACE.SORT_TOP_RATED';
            case 'rating-asc':
                return 'WORKSPACE.SORT_LOWEST_RATED';
            default:
                return 'WORKSPACE.SORT_CUSTOM';
        }
    });
    readonly searchTerm = toSignal(
        this.activatedRoute.queryParamMap.pipe(map((p) => p.get('q') ?? '')),
        { initialValue: '' }
    );
    readonly selectedDetailComponent = computed(() =>
        this.selectedItem() ? this.detailComponent : null
    );
    readonly contentWithProgress = computed(() =>
        (this.paginatedContent() ?? []).map((item: CategoryContentItem) => ({
            ...item,
            ...this.catalog.getItemProgress(item),
        }))
    );

    setContentSortMode(mode: PortalCatalogSortMode): void {
        this.catalog.setContentSortMode(mode);
    }

    setMinRating(value: number | null): void {
        this.catalog.setMinRating?.(value);
    }

    ngOnInit(): void {
        this.activatedRoute.paramMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((params) => {
                this.catalog.initialize(params.get('categoryId'));
                this.openStalkerItemFromNavigationState();
            });

        this.activatedRoute.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((params) => {
                const searchQuery = params.get('q') ?? '';
                const pageIndex = this.toPageIndex(params.get('page'));

                this.catalog.setSearchQuery?.(searchQuery);

                if (!this.hasAppliedInitialQueryParams) {
                    this.hasAppliedInitialQueryParams = true;
                    this.previousSearchQuery = searchQuery;
                    this.catalog.setPage(pageIndex);
                    return;
                }

                const didSearchChange =
                    searchQuery !== this.previousSearchQuery;
                this.previousSearchQuery = searchQuery;

                if (didSearchChange) {
                    this.catalog.setPage(0);
                    if (params.has('page')) {
                        this.clearPageQueryParam();
                    }
                    return;
                }

                this.catalog.setPage(pageIndex);
            });
    }

    onPageChange(event: PageEvent): void {
        this.catalog.setPage(event.pageIndex);
        this.catalog.setLimit(event.pageSize);
        this.scrollGridToTop();

        void this.router.navigate([], {
            relativeTo: this.activatedRoute,
            queryParams: {
                page: event.pageIndex > 0 ? event.pageIndex + 1 : null,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }

    onItemClick(item: CategoryContentItem): void {
        const navigation = this.catalog.selectItem(item);
        if (navigation?.length) {
            this.router.navigate(navigation, {
                relativeTo: this.activatedRoute,
                queryParamsHandling: 'preserve',
            });
        }
    }

    private toPageIndex(value: string | null): number {
        const page = Number(value);
        return Number.isInteger(page) && page > 0 ? page - 1 : 0;
    }

    private scrollGridToTop(): void {
        const gridList = this.hostElement.nativeElement.querySelector(
            'app-grid-list'
        ) as HTMLElement | null;
        gridList?.scrollTo?.({ top: 0 });
    }

    private clearPageQueryParam(): void {
        void this.router.navigate([], {
            relativeTo: this.activatedRoute,
            queryParams: {
                page: null,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }

    private openStalkerItemFromNavigationState(): void {
        if (this.catalog.provider !== 'stalker') {
            return;
        }

        const item = getOpenStalkerItemState(window.history.state);
        if (!item) {
            return;
        }

        this.catalog.selectItem(item as CategoryContentItem);
        clearNavigationStateKeys([
            OPEN_STALKER_ITEM_STATE_KEY,
            'openFavoriteItem',
            'openRecentItem',
        ]);
    }
}
