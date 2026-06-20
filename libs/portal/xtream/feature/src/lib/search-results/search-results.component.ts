import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    Inject,
    Optional,
    signal,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DatabaseService } from '@iptvnator/services';
import { ContentCardComponent } from '@iptvnator/portal/shared/ui';
import { SearchLayoutComponent } from '@iptvnator/portal/shared/ui';
import {
    buildXtreamNavigationTarget,
    isWorkspaceLayoutRoute,
    queryParamSignal,
} from '@iptvnator/portal/shared/util';
import { createLogger } from '@iptvnator/portal/shared/util';
import { SearchFilters } from '@iptvnator/portal/xtream/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    ContentType,
    XtreamSearchResultItem,
} from '@iptvnator/portal/xtream/data-access';
import {
    GlobalSearchResult,
    isM3uGlobalSearchResult,
} from '@iptvnator/shared/interfaces';

interface SearchResultsData {
    isGlobalSearch: boolean;
    initialQuery?: string;
}

interface GlobalSearchResultGroup {
    playlistId: string;
    playlistName: string;
    items: XtreamSearchResultItem[];
}

const GLOBAL_SEARCH_PAGE_SIZE = 100;

function groupResultsByPlaylistId(
    items: XtreamSearchResultItem[]
): GlobalSearchResultGroup[] {
    const groups = new Map<string, GlobalSearchResultGroup>();

    for (const item of items) {
        const playlistId = String(item.playlist_id ?? 'unknown');
        const playlistName = String(item.playlist_name ?? playlistId);
        const group = groups.get(playlistId) ?? {
            playlistId,
            playlistName,
            items: [],
        };
        group.items.push(item);
        groups.set(playlistId, group);
    }

    return [...groups.values()];
}

@Component({
    selector: 'app-search-results',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ContentCardComponent,
        FormsModule,
        MatCheckboxModule,
        MatDialogModule,
        MatIcon,
        MatIconButton,
        MatProgressSpinner,
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
    private globalSearchRequestVersion = 0;
    private lastGlobalSearchTerm = '';
    private lastGlobalSearchTypes: string[] = [];
    private lastGlobalSearchExcludeHidden?: boolean;
    readonly hasMoreGlobalResults = signal(false);
    readonly isLoadingMoreGlobalResults = signal(false);

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

    /** Grouped results computed once per result change (avoids recalculating on every CD cycle) */
    readonly groupedResults = computed(() => {
        const results = this.xtreamStore.searchResults();
        if (!this.isGlobalSearch) {
            return [];
        }
        return groupResultsByPlaylistId(results);
    });

    constructor(
        @Optional() @Inject(MAT_DIALOG_DATA) data: SearchResultsData | null,
        @Optional() public dialogRef: MatDialogRef<SearchResultsComponent>
    ) {
        this.isGlobalSearch =
            data?.isGlobalSearch ||
            this.activatedRoute.snapshot.data?.['isGlobalSearch'] === true;
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
            if (term.length >= this.minSearchLength) {
                const timeout = setTimeout(() => this.executeSearch(), 300);
                onCleanup(() => clearTimeout(timeout));
            } else if (term.length < this.minSearchLength) {
                this.clearResultsOnly();
            }
        });

        effect(() => {
            if (!this.isWorkspaceLayout) {
                return;
            }

            const queryTerm = this.routeSearchTerm();
            if (queryTerm === this.searchTerm()) {
                return;
            }

            this.xtreamStore.setSearchTerm(queryTerm);
        });
    }

    ngAfterViewInit() {
        this.xtreamStore.setSelectedContentType('vod');
        if (this.showInlineSearchInput) {
            setTimeout(() => {
                this.searchLayoutComponent()?.focusSearchInput();
            });
        }
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

        if (this.searchTerm().length >= this.minSearchLength) {
            this.executeSearch();
        }
    }

    /**
     * Clear only the results, not the search term/filters
     */
    private clearResultsOnly() {
        this.globalSearchRequestVersion++;
        this.xtreamStore.setIsSearching(false);
        this.hasMoreGlobalResults.set(false);
        this.isLoadingMoreGlobalResults.set(false);
        this.lastGlobalSearchTerm = '';
        this.lastGlobalSearchTypes = [];
        this.lastGlobalSearchExcludeHidden = undefined;
        this.xtreamStore.setGlobalSearchResults([]);
    }

    async searchGlobal(
        term: string,
        types: string[],
        excludeHidden?: boolean,
        append = false
    ) {
        const trimmedTerm =
            term.trim() || (append ? this.lastGlobalSearchTerm : '');
        const effectiveTypes =
            append && this.lastGlobalSearchTypes.length > 0
                ? this.lastGlobalSearchTypes
                : types;
        const effectiveExcludeHidden =
            append && this.lastGlobalSearchExcludeHidden !== undefined
                ? this.lastGlobalSearchExcludeHidden
                : excludeHidden;

        if (
            trimmedTerm.length < this.minSearchLength ||
            effectiveTypes.length === 0
        ) {
            this.clearResultsOnly();
            return;
        }

        if (
            append &&
            (!this.hasMoreGlobalResults() ||
                this.isLoadingMoreGlobalResults() ||
                this.xtreamStore.isSearching())
        ) {
            return;
        }

        const requestVersion = ++this.globalSearchRequestVersion;
        const offset = append ? this.getCurrentGlobalSearchResults().length : 0;

        if (append) {
            this.isLoadingMoreGlobalResults.set(true);
        } else {
            this.lastGlobalSearchTerm = trimmedTerm;
            this.lastGlobalSearchTypes = [...effectiveTypes];
            this.lastGlobalSearchExcludeHidden = effectiveExcludeHidden;
            this.hasMoreGlobalResults.set(false);
            this.isLoadingMoreGlobalResults.set(false);
            this.xtreamStore.setIsSearching(true);
        }

        try {
            const results = await this.databaseService.globalSearchContent(
                trimmedTerm,
                effectiveTypes,
                effectiveExcludeHidden,
                undefined,
                {
                    limit: GLOBAL_SEARCH_PAGE_SIZE + 1,
                    offset,
                }
            );

            if (requestVersion !== this.globalSearchRequestVersion) {
                return;
            }

            if (results && Array.isArray(results)) {
                const visibleResults = results.slice(
                    0,
                    GLOBAL_SEARCH_PAGE_SIZE
                );
                this.hasMoreGlobalResults.set(
                    results.length > GLOBAL_SEARCH_PAGE_SIZE
                );
                this.xtreamStore.setGlobalSearchResults(
                    append
                        ? [
                              ...this.getCurrentGlobalSearchResults(),
                              ...visibleResults,
                          ]
                        : visibleResults
                );
            } else {
                this.xtreamStore.setIsSearching(false);
                this.hasMoreGlobalResults.set(false);
            }
        } catch (error) {
            if (requestVersion !== this.globalSearchRequestVersion) {
                return;
            }

            this.logger.error('Error in global search', error);
            if (append) {
                this.hasMoreGlobalResults.set(false);
            } else {
                this.xtreamStore.resetSearchResults();
            }
        } finally {
            if (requestVersion === this.globalSearchRequestVersion) {
                this.isLoadingMoreGlobalResults.set(false);
                if (!append) {
                    this.xtreamStore.setIsSearching(false);
                }
            }
        }
    }

    async loadMoreGlobalResults(): Promise<void> {
        if (!this.isGlobalSearch) {
            return;
        }

        const filters = this.filters();
        const types = Object.entries(filters)
            .filter(([, enabled]) => enabled)
            .map(([type]) => type);

        await this.searchGlobal(
            this.searchTerm(),
            types,
            this.excludeHidden(),
            true
        );
    }

    selectItem(item: XtreamSearchResultItem) {
        if (isM3uGlobalSearchResult(item as GlobalSearchResult)) {
            this.selectM3uItem(item as GlobalSearchResult);
            return;
        }

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
        if (this.searchTerm().length >= this.minSearchLength) {
            this.executeSearch();
        }
    }

    getGroupedResults() {
        return this.groupedResults();
    }

    get showInlineSearchInput(): boolean {
        return !this.isWorkspaceLayout;
    }

    get showGlobalCloseButton(): boolean {
        return this.isGlobalSearch && !this.isWorkspaceLayout;
    }

    get minSearchLength(): number {
        return this.isGlobalSearch ? 2 : 3;
    }

    get initialDescriptionKey(): string {
        return this.isGlobalSearch
            ? 'PORTALS.SEARCH_VIEW.GLOBAL_INITIAL_DESCRIPTION'
            : 'PORTALS.SEARCH_VIEW.INITIAL_DESCRIPTION';
    }

    getDisplayType(item: XtreamSearchResultItem): string {
        const result = item as GlobalSearchResult;
        if (isM3uGlobalSearchResult(result) && result.radio === 'true') {
            return 'radio';
        }

        return item.type;
    }

    private getCurrentGlobalSearchResults(): GlobalSearchResult[] {
        return this.xtreamStore.searchResults() as GlobalSearchResult[];
    }

    private selectM3uItem(item: GlobalSearchResult): void {
        if (!isM3uGlobalSearchResult(item)) {
            return;
        }

        if (this.isGlobalSearch) {
            this.dialogRef?.close();
        }

        void this.router.navigate(
            ['/workspace', 'playlists', item.playlist_id, 'all'],
            {
                state: {
                    openM3uChannelUrl: item.stream_url,
                },
            }
        );
    }
}
