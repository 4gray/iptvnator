import { KeyValuePipe } from '@angular/common';
import {
    AfterViewInit,
    Component,
    effect,
    inject,
    Inject,
    Optional,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import groupBy from 'lodash/groupBy';
import { DatabaseService } from 'services';
import { XtreamContentItem } from '../data-sources/xtream-data-source.interface';
import { ContentType } from '../xtream-state';
import { SearchFormComponent } from '../../shared/components/search-form/search-form.component';
import { SearchResultItemComponent } from '../../shared/components/search-result-item/search-result-item.component';
import { XtreamStore } from '../stores/xtream.store';
import { SearchFilters } from '../stores/features/with-search.feature';

interface SearchResultsData {
    isGlobalSearch: boolean;
}

@Component({
    selector: 'app-search-results',
    imports: [
        FormsModule,
        KeyValuePipe,
        MatCardModule,
        MatCheckboxModule,
        MatDialogModule,
        MatFormFieldModule,
        MatIcon,
        MatIconButton,
        MatInputModule,
        SearchFormComponent,
        SearchResultItemComponent,
        TranslatePipe,
    ],
    providers: [],
    templateUrl: './search-results.component.html',
    styleUrls: ['./search-results.component.scss'],
})
export class SearchResultsComponent implements AfterViewInit {
    readonly searchFormComponent = viewChild(SearchFormComponent);
    readonly xtreamStore = inject(XtreamStore);
    readonly router = inject(Router);
    readonly activatedRoute = inject(ActivatedRoute);
    readonly databaseService = inject(DatabaseService);

    /** Search term from store */
    readonly searchTerm = this.xtreamStore.searchTerm;

    /** Search filters from store */
    readonly filters = this.xtreamStore.searchFilters;

    isGlobalSearch = false;

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

    constructor(
        @Optional() @Inject(MAT_DIALOG_DATA) data: SearchResultsData,
        @Optional() public dialogRef: MatDialogRef<SearchResultsComponent>
    ) {
        this.isGlobalSearch = data?.isGlobalSearch || false;

        effect(() => {
            const term = this.searchTerm();
            if (term.length >= 3) {
                this.executeSearch();
            } else if (term.length === 0) {
                // Only clear results when search term is completely empty
                this.clearResultsOnly();
            }
        });
    }

    ngAfterViewInit() {
        this.xtreamStore.setSelectedContentType(undefined);
        setTimeout(() => {
            this.searchFormComponent()?.focusSearchInput();
        });
    }

    executeSearch() {
        const filters = this.filters();
        const types = Object.entries(filters)
            .filter(([_, enabled]) => enabled)
            .map(([type]) => type);

        if (this.isGlobalSearch) {
            this.searchGlobal(this.searchTerm(), types);
        } else {
            this.xtreamStore.searchContent({
                term: this.searchTerm(),
                types,
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
        // Re-execute search when filter changes
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

    async searchGlobal(term: string, types: string[]) {
        try {
            const results = await this.databaseService.globalSearchContent(
                term,
                types
            );
            if (results && Array.isArray(results)) {
                this.xtreamStore.setGlobalSearchResults(results);
            }
        } catch (error) {
            console.error('Error in global search:', error);
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
            const type = (item.type === 'movie' ? 'vod' : item.type) as ContentType;
            // Don't reset search results - preserve them for back navigation
            this.xtreamStore.setSelectedContentType(type);

            this.router.navigate(
                item.type === 'live'
                    ? ['..', type, item.category_id]
                    : ['..', type, item.category_id, item.xtream_id],
                { relativeTo: this.activatedRoute }
            );
        }
    }
    getGroupedResults() {
        const results = this.xtreamStore.searchResults();
        if (!this.isGlobalSearch) return { default: results };
        return groupBy(results, 'playlist_name');
    }
}
