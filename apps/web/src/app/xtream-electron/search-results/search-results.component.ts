import { KeyValuePipe } from '@angular/common';
import {
    AfterViewInit,
    Component,
    computed,
    effect,
    inject,
    Inject,
    Optional,
    signal,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import groupBy from 'lodash/groupBy';
import { map } from 'rxjs';
import { DatabaseService } from 'services';
import { ContentCardComponent } from '../../shared/components/content-card/content-card.component';
import { SearchLayoutComponent } from '../../shared/components/search-layout/search-layout.component';
import { createLogger } from '../../shared/utils/logger';
import { XtreamContentItem } from '../data-sources/xtream-data-source.interface';
import { SearchFilters } from '../stores/features/with-search.feature';
import { XtreamStore } from '../stores/xtream.store';
import { ContentType } from '../xtream-state';

interface SearchResultsData {
    isGlobalSearch: boolean;
}

@Component({
    selector: 'app-search-results',
    imports: [
        ContentCardComponent,
        FormsModule,
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
    private readonly logger = createLogger('XtreamSearchResults');
    readonly isWorkspaceLayout =
        this.activatedRoute.snapshot.data['layout'] === 'workspace';
    readonly routeSearchTerm = toSignal(
        this.activatedRoute.queryParamMap.pipe(
            map((params) => (params.get('q') ?? '').trim())
        ),
        { initialValue: '' }
    );

    /** Search term from store */
    readonly searchTerm = this.xtreamStore.searchTerm;

    /** Search filters from store */
    readonly filters = this.xtreamStore.searchFilters;

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
        if (!this.isGlobalSearch) return { default: results };
        return groupBy(results, 'playlist_name');
    });

    constructor(
        @Optional() @Inject(MAT_DIALOG_DATA) data: SearchResultsData,
        @Optional() public dialogRef: MatDialogRef<SearchResultsComponent>
    ) {
        this.isGlobalSearch = data?.isGlobalSearch || false;

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
            .filter(([_, enabled]) => enabled)
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

    /**
     * Clear only the results, not the search term/filters
     */
    private clearResultsOnly() {
        this.xtreamStore.setGlobalSearchResults([]);
    }

    async searchGlobal(term: string, types: string[], excludeHidden?: boolean) {
        this.xtreamStore.setIsSearching(true);
        try {
            const results = await this.databaseService.globalSearchContent(
                term,
                types,
                excludeHidden
            );
            if (results && Array.isArray(results)) {
                this.xtreamStore.setGlobalSearchResults(results);
            } else {
                this.xtreamStore.setIsSearching(false);
            }
        } catch (error) {
            this.logger.error('Error in global search', error);
            this.xtreamStore.resetSearchResults();
        }
    }

    selectItem(item: XtreamContentItem) {
        if (this.isGlobalSearch && item.playlist_id) {
            this.dialogRef?.close();
            const type = item.type === 'movie' ? 'vod' : item.type;
            this.router.navigate([
                '/xtreams',
                item.playlist_id,
                type,
                item.category_id,
                item.xtream_id,
            ]);
        } else {
            const type = (
                item.type === 'movie' ? 'vod' : item.type
            ) as ContentType;
            this.xtreamStore.setSelectedContentType(type);

            this.router.navigate(
                item.type === 'live'
                    ? ['..', type, item.category_id]
                    : ['..', type, item.category_id, item.xtream_id],
                { relativeTo: this.activatedRoute }
            );
        }
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

    get showInlineSearchInput(): boolean {
        return !this.isWorkspaceLayout || this.isGlobalSearch;
    }
}
