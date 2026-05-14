import { NgComponentOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    ElementRef,
    effect,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
    EMPTY_PORTAL_CATALOG_LANGUAGE_FILTER,
    getOpenStalkerItemState,
    isPortalCatalogLanguageFilterActive,
    PortalCatalogFacade,
    PortalCatalogLanguageFilterSection,
    OPEN_STALKER_ITEM_STATE_KEY,
    PORTAL_CATALOG_DETAIL_COMPONENT,
    PORTAL_CATALOG_FACADE,
    PortalCatalogSortMode,
    PortalCatalogVideoQualityFilterValue,
    isPortalCatalogVideoQualityFilterActive,
} from '@iptvnator/portal/shared/util';

interface CategoryContentItem {
    category_hidden?: boolean | number;
    id?: number | string;
    is_series?: number | string | boolean;
    xtream_id?: number | string;
    series_id?: number | string;
    stream_id?: number | string;
    category_id?: number | string;
    [key: string]: unknown;
}

interface CategoryContentSection {
    key: 'all' | 'visible' | 'hidden' | 'filter-excluded';
    titleKey: string | null;
    items: CategoryContentItem[];
}

interface LanguageFilterSectionView {
    key: PortalCatalogLanguageFilterSection;
    titleKey: string;
}

@Component({
    selector: 'app-category-content-view',
    templateUrl: './category-content-view.component.html',
    styleUrls: ['./category-content-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule,
        GridListComponent,
        MatButtonModule,
        MatCheckboxModule,
        MatIcon,
        MatIconButton,
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
    readonly showLanguageFilterPanel = signal(false);
    readonly languageFilterSections: LanguageFilterSectionView[] = [
        {
            key: 'audioInclude',
            titleKey: 'PORTALS.LANGUAGE_FILTER.AUDIO_INCLUDE',
        },
        {
            key: 'audioExclude',
            titleKey: 'PORTALS.LANGUAGE_FILTER.AUDIO_EXCLUDE',
        },
        {
            key: 'subtitleInclude',
            titleKey: 'PORTALS.LANGUAGE_FILTER.SUBTITLE_INCLUDE',
        },
        {
            key: 'subtitleExclude',
            titleKey: 'PORTALS.LANGUAGE_FILTER.SUBTITLE_EXCLUDE',
        },
    ];

    readonly detailComponent = inject(PORTAL_CATALOG_DETAIL_COMPONENT);
    readonly contentType = this.catalog.contentType;
    readonly limit = this.catalog.limit;
    readonly pageIndex = this.catalog.pageIndex;
    readonly pageSizeOptions = Array.from(this.catalog.pageSizeOptions);
    readonly selectedCategory = this.catalog.selectedCategory;
    readonly paginatedContent = this.catalog.paginatedContent;
    readonly allContent = this.catalog.allContent;
    readonly filterExcludedContent = this.catalog.filterExcludedContent;
    readonly selectedCategoryTitle = this.catalog.selectedCategoryTitle;
    readonly categoryItemCount = this.catalog.categoryItemCount;
    readonly selectedItem = this.catalog.selectedItem;
    readonly totalPages = this.catalog.totalPages;
    readonly contentSortMode = this.catalog.contentSortMode;
    readonly languageFilter = computed(
        () =>
            this.catalog.languageFilter?.() ??
            EMPTY_PORTAL_CATALOG_LANGUAGE_FILTER
    );
    readonly languageFilterOptions = computed(
        () => this.catalog.languageFilterOptions?.() ?? []
    );
    readonly canFilterLanguages = computed(() =>
        Boolean(
            this.catalog.languageFilter &&
            this.catalog.toggleLanguageFilterOption
        )
    );
    readonly languageFilterActive = computed(
        () =>
            this.catalog.languageFilterActive?.() ??
            isPortalCatalogLanguageFilterActive(this.languageFilter())
    );
    readonly videoQualityFilter = computed(
        () => this.catalog.videoQualityFilter?.() ?? 'all'
    );
    readonly videoQualityFilterOptions = computed(
        () => this.catalog.videoQualityFilterOptions?.() ?? []
    );
    readonly canFilterVideoQuality = computed(() => {
        const contentType = this.contentType();

        return (
            (contentType === 'vod' || contentType === 'series') &&
            Boolean(this.catalog.setVideoQualityFilter)
        );
    });
    readonly videoQualityFilterActive = computed(
        () =>
            this.catalog.videoQualityFilterActive?.() ??
            isPortalCatalogVideoQualityFilterActive(this.videoQualityFilter())
    );
    readonly canWarmMediaMetadata = computed(() =>
        Boolean(this.catalog.warmVisibleMediaMetadata)
    );
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
    readonly searchTerm = toSignal(
        this.activatedRoute.queryParamMap.pipe(map((p) => p.get('q') ?? '')),
        { initialValue: '' }
    );
    readonly selectedDetailComponent = computed(() =>
        this.selectedItem() ? this.detailComponent : null
    );
    readonly showSearchVisibilitySections = computed(() => {
        const selectedCategory = this.selectedCategory();
        return (
            this.catalog.provider === 'xtream' &&
            this.searchTerm().trim().length > 0 &&
            Number(selectedCategory?.['id']) === 0
        );
    });
    readonly contentWithProgress = computed(() =>
        this.addProgress(this.paginatedContent() ?? [])
    );
    readonly contentSectionsWithProgress = computed<CategoryContentSection[]>(
        () => {
            if (!this.showSearchVisibilitySections()) {
                return [
                    {
                        key: 'all',
                        titleKey: null,
                        items: this.contentWithProgress(),
                    },
                ];
            }

            const items = this.addProgress(
                (this.allContent?.() ?? this.paginatedContent() ?? []) as
                    | CategoryContentItem[]
                    | readonly CategoryContentItem[]
            );
            const visibleItems = items.filter(
                (item) => !this.isHiddenCategory(item)
            );
            const hiddenItems = items.filter((item) =>
                this.isHiddenCategory(item)
            );
            const filterExcludedItems = this.addProgress(
                (this.filterExcludedContent?.() ?? []) as
                    | CategoryContentItem[]
                    | readonly CategoryContentItem[]
            );
            const sections: CategoryContentSection[] = [];

            if (
                visibleItems.length ||
                (!hiddenItems.length && !filterExcludedItems.length)
            ) {
                sections.push({
                    key: 'visible',
                    titleKey: 'PORTALS.SEARCH_VIEW.VISIBLE_CATEGORIES_SECTION',
                    items: visibleItems,
                });
            }

            if (hiddenItems.length) {
                sections.push({
                    key: 'hidden',
                    titleKey: 'PORTALS.SEARCH_VIEW.HIDDEN_CATEGORIES_SECTION',
                    items: hiddenItems,
                });
            }

            if (filterExcludedItems.length) {
                sections.push({
                    key: 'filter-excluded',
                    titleKey: 'PORTALS.SEARCH_VIEW.FILTER_EXCLUDED_SECTION',
                    items: filterExcludedItems,
                });
            }

            return sections;
        }
    );

    constructor() {
        effect(() => {
            if (!this.canWarmMediaMetadata()) {
                return;
            }

            this.catalog.warmVisibleMediaMetadata?.(this.contentWithProgress());
        });
    }

    setContentSortMode(mode: PortalCatalogSortMode): void {
        this.catalog.setContentSortMode(mode);
    }

    toggleLanguageFilterPanel(): void {
        this.showLanguageFilterPanel.update((value) => !value);
    }

    resetLanguageFilter(): void {
        this.catalog.resetLanguageFilter?.();
    }

    isLanguageFilterOptionChecked(
        section: PortalCatalogLanguageFilterSection,
        code: string
    ): boolean {
        return this.languageFilter()[section].includes(code);
    }

    toggleLanguageFilterOption(
        section: PortalCatalogLanguageFilterSection,
        code: string,
        enabled: boolean
    ): void {
        this.catalog.toggleLanguageFilterOption?.(section, code, enabled);
    }

    selectAllLanguageFilterOptions(
        section: PortalCatalogLanguageFilterSection
    ): void {
        this.catalog.selectAllLanguageFilterOptions?.(section);
    }

    clearLanguageFilterOptions(
        section: PortalCatalogLanguageFilterSection
    ): void {
        this.catalog.clearLanguageFilterOptions?.(section);
    }

    invertLanguageFilterOptions(
        section: PortalCatalogLanguageFilterSection
    ): void {
        this.catalog.invertLanguageFilterOptions?.(section);
    }

    setVideoQualityFilter(filter: PortalCatalogVideoQualityFilterValue): void {
        this.catalog.setVideoQualityFilter?.(filter);
    }

    resetVideoQualityFilter(): void {
        this.catalog.resetVideoQualityFilter?.();
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
            '.category-search-sections, app-grid-list'
        ) as HTMLElement | null;
        gridList?.scrollTo?.({ top: 0 });
    }

    private addProgress(
        items: readonly CategoryContentItem[]
    ): CategoryContentItem[] {
        return items.map((item: CategoryContentItem) => ({
            ...item,
            ...this.catalog.getItemProgress(item),
        }));
    }

    private isHiddenCategory(item: CategoryContentItem): boolean {
        return item.category_hidden === true || item.category_hidden === 1;
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
