import { KeyValuePipe } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    effect,
    inject,
    Inject,
    Optional,
    signal,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DatabaseService } from 'services';
import { ContentCardComponent } from '@iptvnator/portal/shared/ui';
import { GridListItem } from '@iptvnator/portal/shared/ui';
import { SearchLayoutComponent } from '@iptvnator/portal/shared/ui';
import {
    resolveGridMediaTags,
    resolveGridRating,
    resolveGridRatingTooltip,
} from '@iptvnator/portal/shared/ui';
import {
    buildXtreamNavigationTarget,
    EMPTY_PORTAL_CATALOG_LANGUAGE_FILTER,
    isPortalCatalogLanguageFilterActive,
    isPortalCatalogVideoQualityFilterActive,
    isWorkspaceLayoutRoute,
    PortalCatalogLanguageFilterSection,
    PortalCatalogVideoQualityFilterValue,
    queryParamSignal,
} from '@iptvnator/portal/shared/util';
import { createLogger } from '@iptvnator/portal/shared/util';
import { XtreamContentItem } from '@iptvnator/portal/xtream/data-access';
import { SearchFilters } from '@iptvnator/portal/xtream/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { ContentType } from '@iptvnator/portal/xtream/data-access';

interface SearchResultsData {
    isGlobalSearch: boolean;
    initialQuery?: string;
}

interface SearchResultsSection {
    readonly key: 'visible' | 'hidden' | 'filter-excluded';
    readonly titleKey: string;
    readonly items: XtreamContentItem[];
    readonly groupedItems: Record<string, XtreamContentItem[]>;
}

interface LanguageFilterSectionView {
    key: PortalCatalogLanguageFilterSection;
    titleKey: string;
}

function groupResultsByPlaylistName(
    items: XtreamContentItem[]
): Record<string, XtreamContentItem[]> {
    return items.reduce<Record<string, XtreamContentItem[]>>((groups, item) => {
        const key = String(item.playlist_name);
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(item);
        return groups;
    }, {});
}

@Component({
    selector: 'app-search-results',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ContentCardComponent,
        FormsModule,
        MatButtonModule,
        KeyValuePipe,
        MatCheckboxModule,
        MatDialogModule,
        MatIcon,
        MatIconButton,
        SearchLayoutComponent,
        TranslatePipe,
    ],
    providers: [],
    templateUrl: './search-results.component.html',
    styleUrls: ['./search-results.component.scss'],
})
export class SearchResultsComponent implements AfterViewInit {
    readonly searchLayoutComponent = viewChild(SearchLayoutComponent);
    readonly xtreamStore = inject(XtreamStore);
    readonly router = inject(Router);
    readonly activatedRoute = inject(ActivatedRoute);
    readonly databaseService = inject(DatabaseService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly logger = createLogger('XtreamSearchResults');
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.activatedRoute);
    readonly routeSearchTerm = queryParamSignal(
        this.activatedRoute,
        'q',
        (value) => (value ?? '').trim()
    );

    /** Search term from store */
    readonly searchTerm = this.xtreamStore.searchTerm;

    /** Search filters from store */
    readonly filters = this.xtreamStore.searchFilters;
    readonly languageFilter = computed(
        () =>
            this.xtreamStore.languageFilter?.() ??
            EMPTY_PORTAL_CATALOG_LANGUAGE_FILTER
    );
    readonly languageFilterOptions = computed(
        () => this.xtreamStore.languageFilterOptions?.() ?? []
    );
    readonly languageFilterActive = computed(
        () =>
            this.xtreamStore.languageFilterActive?.() ??
            isPortalCatalogLanguageFilterActive(this.languageFilter())
    );
    readonly videoQualityFilter = computed(
        () => this.xtreamStore.videoQualityFilter?.() ?? 'all'
    );
    readonly videoQualityFilterOptions = computed(
        () => this.xtreamStore.videoQualityFilterOptions?.() ?? []
    );
    readonly videoQualityFilterActive = computed(
        () =>
            this.xtreamStore.videoQualityFilterActive?.() ??
            isPortalCatalogVideoQualityFilterActive(this.videoQualityFilter())
    );
    readonly metadataFiltersReady = computed(
        () => this.xtreamStore.metadataFiltersReady?.() ?? true
    );
    readonly hasSelectedLanguageFilter = computed(() =>
        isPortalCatalogLanguageFilterActive(this.languageFilter())
    );
    readonly metadataFilterActive = computed(
        () => this.languageFilterActive() || this.videoQualityFilterActive()
    );
    private readonly metadataBackgroundStatus =
        signal<MediaMetadataBackgroundStatus | null>(null);
    readonly filterIndexProgress = computed(() => {
        const metadataProgress = this.metadataBackgroundFilterProgress();
        if (metadataProgress) {
            return metadataProgress;
        }

        return this.xtreamStore.filterIndexProgress?.() ?? null;
    });
    readonly showFilterIndexProgress = computed(() => {
        const progress = this.filterIndexProgress();
        return Boolean(
            progress && progress.totalItems > 0 && progress.status === 'running'
        );
    });
    readonly filteredResults = computed(
        () =>
            this.xtreamStore.filteredSearchResults?.() ??
            this.xtreamStore.searchResults()
    );
    private globalSearchRequestVersion = 0;

    private static readonly GROUP_BY_STORAGE_KEY =
        'global-search-group-by-playlist';
    private static readonly EXCLUDE_HIDDEN_STORAGE_KEY =
        'xtream-search-exclude-hidden';
    private static readonly TYPE_FILTERS_STORAGE_KEY =
        'global-search-type-filters';

    isGlobalSearch = false;

    /** Whether to group global search results by playlist */
    readonly groupByPlaylist = signal(
        localStorage.getItem(SearchResultsComponent.GROUP_BY_STORAGE_KEY) !==
            'false'
    );

    /** Whether to exclude content from hidden categories */
    readonly excludeHidden = signal(
        localStorage.getItem(
            SearchResultsComponent.EXCLUDE_HIDDEN_STORAGE_KEY
        ) === 'true'
    );

    readonly filterConfig = [
        {
            key: 'live' as keyof SearchFilters,
            label: 'Live TV',
            translationKey: 'PORTALS.SIDEBAR.LIVE_TV',
        },
        {
            key: 'movie' as keyof SearchFilters,
            label: 'Movies',
            translationKey: 'PORTALS.SIDEBAR.MOVIES',
        },
        {
            key: 'series' as keyof SearchFilters,
            label: 'Series',
            translationKey: 'PORTALS.SIDEBAR.SERIES',
        },
    ];
    readonly languageFilterSections: LanguageFilterSectionView[] = [
        {
            key: 'audioInclude',
            titleKey: 'PORTALS.LANGUAGE_FILTER.AUDIO_INCLUDE',
        },
        {
            key: 'subtitleInclude',
            titleKey: 'PORTALS.LANGUAGE_FILTER.SUBTITLE_INCLUDE',
        },
    ];

    /** Grouped results computed once per result change (avoids recalculating on every CD cycle) */
    readonly groupedResults = computed(() => {
        const results = this.filteredResults();
        if (!this.isGlobalSearch) return { default: results };
        return groupResultsByPlaylistName(results);
    });

    readonly resultSections = computed<SearchResultsSection[]>(() => {
        const filteredResults = this.filteredResults();
        const rawResults = this.xtreamStore.searchResults();
        const filteredKeys = new Set(
            filteredResults.map((item) => this.getSearchResultKey(item))
        );
        const filterExcludedItems = this.metadataFilterActive()
            ? rawResults.filter(
                  (item) => !filteredKeys.has(this.getSearchResultKey(item))
              )
            : [];
        const visibleItems = filteredResults.filter(
            (item) => !this.isHiddenCategory(item)
        );
        const hiddenItems = filteredResults.filter((item) =>
            this.isHiddenCategory(item)
        );
        const sections: SearchResultsSection[] = [];

        if (
            visibleItems.length ||
            (!hiddenItems.length && !filterExcludedItems.length)
        ) {
            sections.push(this.createResultSection('visible', visibleItems));
        }

        if (!this.excludeHidden() && hiddenItems.length) {
            sections.push(this.createResultSection('hidden', hiddenItems));
        }

        if (filterExcludedItems.length) {
            sections.push(
                this.createResultSection('filter-excluded', filterExcludedItems)
            );
        }

        return sections;
    });
    readonly resolveRating = (item: XtreamContentItem) =>
        resolveGridRating(item as unknown as GridListItem);
    readonly resolveRatingTooltip = (item: XtreamContentItem) =>
        resolveGridRatingTooltip(item as unknown as GridListItem);
    readonly resolveMediaTags = (item: XtreamContentItem) =>
        resolveGridMediaTags(item as unknown as GridListItem);

    constructor(
        @Optional() @Inject(MAT_DIALOG_DATA) data: SearchResultsData,
        @Optional() public dialogRef: MatDialogRef<SearchResultsComponent>
    ) {
        this.isGlobalSearch = data?.isGlobalSearch || false;
        const initialQuery = (data?.initialQuery ?? '').trim();

        if (this.isGlobalSearch) {
            const savedFilters = localStorage.getItem(
                SearchResultsComponent.TYPE_FILTERS_STORAGE_KEY
            );
            if (savedFilters) {
                try {
                    const parsed = JSON.parse(
                        savedFilters
                    ) as Partial<SearchFilters>;
                    this.xtreamStore.setSearchFilters({
                        live: parsed.live !== false,
                        movie: parsed.movie !== false,
                        series: parsed.series !== false,
                    });
                } catch {
                    // Ignore malformed storage value and keep defaults.
                }
            }

            if (initialQuery) {
                this.xtreamStore.setSearchTerm(initialQuery);
            }
        }

        effect((onCleanup) => {
            const term = this.searchTerm();
            if (term.length >= 3) {
                const timeout = setTimeout(() => this.executeSearch(), 300);
                onCleanup(() => clearTimeout(timeout));
            } else if (term.length === 0) {
                this.clearResultsOnly();
            }
        });

        effect(() => {
            if (this.isGlobalSearch || !this.isWorkspaceLayout) {
                return;
            }

            const queryTerm = this.routeSearchTerm();
            if (!queryTerm || queryTerm === this.searchTerm()) {
                return;
            }

            this.xtreamStore.setSearchTerm(queryTerm);
        });

        this.connectMetadataBackgroundProgress();
    }

    ngAfterViewInit() {
        this.xtreamStore.setSelectedContentType(undefined);
        setTimeout(() => {
            this.searchLayoutComponent()?.focusSearchInput();
        });
    }

    executeSearch() {
        const filters = this.filters();
        const types = Object.entries(filters)
            .filter(([, enabled]) => enabled)
            .map(([type]) => type);
        const excludeHidden = this.excludeHidden();

        if (this.isGlobalSearch) {
            this.searchGlobal(this.searchTerm(), types, excludeHidden);
        } else {
            this.xtreamStore.searchContent({
                term: this.searchTerm(),
                types,
                excludeHidden,
            });
        }
    }

    /**
     * Update search term in the store
     */
    updateSearchTerm(term: string) {
        this.xtreamStore.setSearchTerm(term);
    }

    /**
     * Update a single filter in the store
     */
    updateFilter(key: keyof SearchFilters, value: boolean) {
        this.xtreamStore.updateSearchFilter(key, value);

        if (this.isGlobalSearch) {
            localStorage.setItem(
                SearchResultsComponent.TYPE_FILTERS_STORAGE_KEY,
                JSON.stringify(this.xtreamStore.searchFilters())
            );
        }

        if (this.searchTerm().length >= 3) {
            this.executeSearch();
        }
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
        this.xtreamStore.toggleLanguageFilterOption?.(section, code, enabled);
    }

    selectAllLanguageFilterOptions(
        section: PortalCatalogLanguageFilterSection
    ): void {
        this.xtreamStore.selectAllLanguageFilterOptions?.(section);
    }

    clearLanguageFilterOptions(
        section: PortalCatalogLanguageFilterSection
    ): void {
        this.xtreamStore.clearLanguageFilterOptions?.(section);
    }

    invertLanguageFilterOptions(
        section: PortalCatalogLanguageFilterSection
    ): void {
        this.xtreamStore.invertLanguageFilterOptions?.(section);
    }

    resetLanguageFilter(): void {
        this.xtreamStore.resetLanguageFilter?.();
    }

    setVideoQualityFilter(filter: PortalCatalogVideoQualityFilterValue): void {
        this.xtreamStore.setVideoQualityFilter?.(filter);
    }

    resetVideoQualityFilter(): void {
        this.xtreamStore.resetVideoQualityFilter?.();
    }

    /**
     * Clear only the results, not the search term/filters
     */
    private clearResultsOnly() {
        this.globalSearchRequestVersion++;
        this.xtreamStore.setIsSearching(false);
        this.xtreamStore.setGlobalSearchResults([]);
    }

    async searchGlobal(term: string, types: string[], excludeHidden?: boolean) {
        const requestVersion = ++this.globalSearchRequestVersion;
        this.xtreamStore.setIsSearching(true);
        try {
            const results = await this.databaseService.globalSearchContent(
                term,
                types,
                excludeHidden
            );

            if (requestVersion !== this.globalSearchRequestVersion) {
                return;
            }

            if (results && Array.isArray(results)) {
                this.xtreamStore.setGlobalSearchResults(results);
            } else {
                this.xtreamStore.setIsSearching(false);
            }
        } catch (error) {
            if (requestVersion !== this.globalSearchRequestVersion) {
                return;
            }

            this.logger.error('Error in global search', error);
            this.xtreamStore.resetSearchResults();
        }
    }

    selectItem(item: XtreamContentItem) {
        const playlistId = item.playlist_id ?? this.xtreamStore.playlistId();
        if (!playlistId) {
            return;
        }

        const type = (item.type === 'movie' ? 'vod' : item.type) as ContentType;
        const navigationType =
            item.type === 'movie'
                ? 'movie'
                : item.type === 'series'
                  ? 'series'
                  : 'live';
        this.xtreamStore.setSelectedContentType(type);

        const navigation = buildXtreamNavigationTarget({
            playlistId,
            type: navigationType,
            categoryId: item.category_id,
            itemId: item.xtream_id,
            title: item.title,
            imageUrl: item.poster_url,
        });

        if (this.isGlobalSearch) {
            this.dialogRef?.close();
        }

        void this.router.navigate(navigation.link, {
            state: navigation.state,
        });
    }

    onCloseDialog() {
        this.dialogRef?.close();
    }

    toggleGroupByPlaylist(value: boolean) {
        this.groupByPlaylist.set(value);
        localStorage.setItem(
            SearchResultsComponent.GROUP_BY_STORAGE_KEY,
            String(value)
        );
    }

    toggleExcludeHidden(value: boolean) {
        this.excludeHidden.set(value);
        localStorage.setItem(
            SearchResultsComponent.EXCLUDE_HIDDEN_STORAGE_KEY,
            String(value)
        );
        if (this.searchTerm().length >= 3) {
            this.executeSearch();
        }
    }

    getGroupedResults() {
        return this.groupedResults();
    }

    private createResultSection(
        key: 'visible' | 'hidden' | 'filter-excluded',
        items: XtreamContentItem[]
    ): SearchResultsSection {
        return {
            key,
            titleKey: this.getSectionTitleKey(key),
            items,
            groupedItems: this.isGlobalSearch
                ? groupResultsByPlaylistName(items)
                : { default: items },
        };
    }

    private getSectionTitleKey(key: SearchResultsSection['key']): string {
        switch (key) {
            case 'hidden':
                return 'PORTALS.SEARCH_VIEW.HIDDEN_CATEGORIES_SECTION';
            case 'filter-excluded':
                return 'PORTALS.SEARCH_VIEW.FILTER_EXCLUDED_SECTION';
            default:
                return 'PORTALS.SEARCH_VIEW.VISIBLE_CATEGORIES_SECTION';
        }
    }

    private connectMetadataBackgroundProgress(): void {
        if (!window.electron?.getMediaMetadataBackgroundStatus) {
            return;
        }

        void window.electron
            .getMediaMetadataBackgroundStatus()
            .then((status) => this.metadataBackgroundStatus.set(status))
            .catch((error) => {
                this.logger.error(
                    'Failed to read metadata background progress',
                    error
                );
            });

        const unsubscribe = window.electron.onMediaMetadataBackgroundEvent?.(
            (event) => {
                const status = this.extractMetadataBackgroundStatus(event);
                if (status) {
                    this.metadataBackgroundStatus.set(status);
                }
            }
        );

        if (typeof unsubscribe === 'function') {
            this.destroyRef.onDestroy(unsubscribe);
        }
    }

    private metadataBackgroundFilterProgress() {
        const status = this.metadataBackgroundStatus();
        if (!status?.running || status.totalItems <= 0) {
            return null;
        }

        const processedItems = Math.max(0, status.processedItems);
        const totalItems = Math.max(processedItems, status.totalItems);

        return {
            status: 'running' as const,
            processedItems,
            totalItems,
            percent:
                totalItems > 0
                    ? Math.min(
                          100,
                          Math.round((processedItems / totalItems) * 100)
                      )
                    : 0,
            updatedAt: Date.now(),
        };
    }

    private extractMetadataBackgroundStatus(
        event: unknown
    ): MediaMetadataBackgroundStatus | null {
        const candidate = event as
            | { status?: MediaMetadataBackgroundStatus }
            | null
            | undefined;

        return candidate?.status &&
            typeof candidate.status === 'object' &&
            typeof candidate.status.running === 'boolean'
            ? candidate.status
            : null;
    }

    private getSearchResultKey(item: XtreamContentItem): string {
        const storePlaylistId = (
            this.xtreamStore as {
                playlistId?: () => string | null | undefined;
            }
        ).playlistId?.();

        return [
            item.playlist_id ?? storePlaylistId ?? '',
            item.type,
            item.xtream_id ?? item.series_id ?? item.stream_id ?? item.id,
        ].join(':');
    }

    private isHiddenCategory(item: XtreamContentItem): boolean {
        const value = item.category_hidden;
        return value === true || value === 1;
    }

    get showInlineSearchInput(): boolean {
        return !this.isWorkspaceLayout || this.isGlobalSearch;
    }
}
