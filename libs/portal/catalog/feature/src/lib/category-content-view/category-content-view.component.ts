import { NgComponentOutlet } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    ElementRef,
    inject,
    OnDestroy,
    OnInit,
    signal,
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
    InfiniteScrollDirective,
    PlaylistErrorViewComponent,
} from '@iptvnator/portal/shared/ui';
import {
    clearNavigationStateKeys,
    getOpenStalkerItemState,
    isProviderOnlyDetailState,
    PortalCatalogFacade,
    OPEN_STALKER_ITEM_STATE_KEY,
    PORTAL_CATALOG_DETAIL_COMPONENT,
    PORTAL_CATALOG_FACADE,
    PROVIDER_ONLY_DETAIL_PRESENTATION_STATE_KEY,
    PortalCatalogSortMode,
} from '@iptvnator/portal/shared/util';

interface CategoryContentItem {
    id?: number | string;
    is_series?: number | string | boolean;
    movie_id?: number | string;
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
        InfiniteScrollDirective,
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
export class CategoryContentViewComponent implements OnInit, OnDestroy {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly destroyRef = inject(DestroyRef);
    private readonly hostElement = inject(ElementRef<HTMLElement>);
    private readonly router = inject(Router);
    private readonly translate = inject(TranslateService);
    private readonly providerOnlyStalkerItemId = signal<string | null>(null);
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
    /**
     * Transitional (pagination removal, PR 1): infinite scroll drives Xtream,
     * while a facade without the capability (Stalker) keeps the paginator and
     * the `?page=` round-trip below. PR 2 deletes the paged branch.
     */
    readonly supportsInfiniteScroll =
        this.catalog.supportsInfiniteScroll === true;
    readonly limit = this.catalog.limit ?? computed(() => 0);
    readonly pageIndex = this.catalog.pageIndex ?? computed(() => 0);
    readonly pageSizeOptions = Array.from(this.catalog.pageSizeOptions ?? []);
    readonly selectedCategory = this.catalog.selectedCategory;
    readonly paginatedContent = this.catalog.paginatedContent;
    readonly selectedCategoryTitle = this.catalog.selectedCategoryTitle;
    readonly categoryItemCount = this.catalog.categoryItemCount;
    readonly selectedItem = this.catalog.selectedItem;
    readonly contentSortMode = this.catalog.contentSortMode;
    readonly isPaginatedContentLoading = this.catalog.isPaginatedContentLoading;
    readonly infiniteHasMore = computed(
        () =>
            this.supportsInfiniteScroll && (this.catalog.hasMore?.() ?? false)
    );
    readonly infiniteAppending = computed(
        () => this.catalog.isAppending?.() ?? false
    );
    readonly infiniteAppendError = computed(
        () => this.catalog.appendError?.() ?? false
    );
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
    readonly detailComponentInputs = computed<
        Record<string, unknown> | undefined
    >(() => {
        if (this.catalog.provider !== 'stalker') {
            return undefined;
        }

        const providerItemId = this.providerOnlyStalkerItemId();
        return {
            providerOnly:
                providerItemId !== null &&
                providerItemId ===
                    this.stalkerItemIdentity(this.selectedItem()),
        };
    });
    readonly contentWithProgress = computed(() =>
        (this.paginatedContent() ?? []).map((item: CategoryContentItem) => ({
            ...item,
            ...this.catalog.getItemProgress(item),
        }))
    );
    /**
     * Identity of the rendered list. A change means the grid shows a
     * different result set: the scroll resets to the top and the infinite
     * scroll directive gets a fresh auto-fill budget. Appends keep the key
     * stable, so they never scroll.
     */
    readonly gridResetKey = computed(() => {
        const category = this.selectedCategory();
        const categoryId = category?.category_id ?? category?.id ?? '';
        return [
            this.contentType() ?? '',
            String(categoryId),
            this.searchTerm(),
            this.contentSortMode() ?? '',
            String(this.minRating() ?? ''),
        ].join('|');
    });
    private previousGridResetKey: string | null = null;
    private hasAttemptedScrollRestore = false;

    constructor() {
        effect(() => {
            const resetKey = this.gridResetKey();
            if (!this.supportsInfiniteScroll) {
                return;
            }

            if (
                this.previousGridResetKey !== null &&
                this.previousGridResetKey !== resetKey
            ) {
                this.scrollGridToTop();
            }
            this.previousGridResetKey = resetKey;
        });

        // One-shot scroll restore after a detail round-trip: once the list is
        // rendered (not loading, no detail overlay), ask the facade for a
        // saved position matching the current selection.
        effect(() => {
            if (
                !this.supportsInfiniteScroll ||
                this.hasAttemptedScrollRestore ||
                this.isPaginatedContentLoading() ||
                this.selectedItem()
            ) {
                return;
            }

            this.hasAttemptedScrollRestore = true;
            const scrollTop =
                this.catalog.consumeSavedScrollPosition?.() ?? null;
            if (scrollTop === null || scrollTop <= 0) {
                return;
            }

            // Two frames: one for change detection to render the restored
            // window, one to apply the offset to the grown grid.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.gridElement()?.scrollTo?.({ top: scrollTop });
                });
            });
        });
    }

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
                this.providerOnlyStalkerItemId.set(null);
                this.catalog.initialize(params.get('categoryId'));
                this.openStalkerItemFromNavigationState();
            });

        this.activatedRoute.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((params) => {
                const searchQuery = params.get('q') ?? '';

                this.catalog.setSearchQuery?.(searchQuery);

                if (this.supportsInfiniteScroll) {
                    // A search change resets the render window in the store;
                    // only a stale `?page=` from a legacy deep link needs
                    // cleaning up here.
                    if (params.has('page')) {
                        this.clearPageQueryParam();
                    }
                    return;
                }

                const pageIndex = this.toPageIndex(params.get('page'));

                if (!this.hasAppliedInitialQueryParams) {
                    this.hasAppliedInitialQueryParams = true;
                    this.previousSearchQuery = searchQuery;
                    this.catalog.setPage?.(pageIndex);
                    return;
                }

                const didSearchChange =
                    searchQuery !== this.previousSearchQuery;
                this.previousSearchQuery = searchQuery;

                if (didSearchChange) {
                    this.catalog.setPage?.(0);
                    if (params.has('page')) {
                        this.clearPageQueryParam();
                    }
                    return;
                }

                this.catalog.setPage?.(pageIndex);
            });
    }

    ngOnDestroy(): void {
        // Leaving the list without opening a detail (e.g. switching portal
        // tabs) still snapshots the spot; the facade validates the selection
        // before ever restoring it.
        if (this.supportsInfiniteScroll && !this.selectedItem()) {
            const grid = this.gridElement();
            if (grid) {
                this.catalog.saveScrollPosition?.(grid.scrollTop);
            }
        }
    }

    onPageChange(event: PageEvent): void {
        this.catalog.setPage?.(event.pageIndex);
        this.catalog.setLimit?.(event.pageSize);
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

    onLoadMore(): void {
        this.catalog.loadMore?.();
    }

    onRetryAppend(): void {
        this.catalog.retryAppend?.();
    }

    onItemClick(item: CategoryContentItem): void {
        if (this.supportsInfiniteScroll) {
            // Snapshot the grid offset before the detail replaces the list.
            const grid = this.gridElement();
            if (grid) {
                this.catalog.saveScrollPosition?.(grid.scrollTop);
            }
        }

        this.providerOnlyStalkerItemId.set(null);
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

    private gridElement(): HTMLElement | null {
        return this.hostElement.nativeElement.querySelector(
            'app-grid-list'
        ) as HTMLElement | null;
    }

    private scrollGridToTop(): void {
        this.gridElement()?.scrollTo?.({ top: 0 });
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

        const providerOnly = isProviderOnlyDetailState(window.history.state);
        this.catalog.selectItem(item as CategoryContentItem);
        // The item came from a stored snapshot, not the live list — let the
        // provider refresh stale embedded data (e.g. episode lists).
        this.catalog.refreshSnapshotSelection?.();
        this.providerOnlyStalkerItemId.set(
            providerOnly
                ? this.stalkerItemIdentity(item as CategoryContentItem)
                : null
        );
        clearNavigationStateKeys([
            OPEN_STALKER_ITEM_STATE_KEY,
            'openFavoriteItem',
            'openRecentItem',
            PROVIDER_ONLY_DETAIL_PRESENTATION_STATE_KEY,
        ]);
    }

    private stalkerItemIdentity(
        item: CategoryContentItem | null | undefined
    ): string | null {
        const rawId =
            item?.id ?? item?.series_id ?? item?.movie_id ?? item?.stream_id;
        const normalized = String(rawId ?? '')
            .trim()
            .split(':')[0]
            ?.trim();
        return normalized || null;
    }
}
