import { KeyValuePipe } from '@angular/common';
import {
    AfterViewInit,
    Component,
    ElementRef,
    inject,
    Inject,
    OnDestroy,
    Optional,
    ViewChild,
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
import groupBy from 'lodash/groupBy';
import { debounceTime, Subject } from 'rxjs';
import { XtreamItem } from '../../../../shared/xtream-item.interface';
import { DatabaseService } from '../../services/database.service';
import { XtreamStore } from '../xtream.store';

interface SearchResultsData {
    isGlobalSearch: boolean;
}

@Component({
    selector: 'app-search-results',
    standalone: true,
    imports: [
        MatIconButton,
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatIcon,
        MatCheckboxModule,
        FormsModule,
        MatDialogModule,
        KeyValuePipe,
    ],
    providers: [],
    templateUrl: './search-results.component.html',
    styleUrls: ['./search-results.component.scss'],
})
export class SearchResultsComponent implements AfterViewInit, OnDestroy {
    @ViewChild('searchInput') searchInput!: ElementRef;
    readonly xtreamStore = inject(XtreamStore);
    readonly router = inject(Router);
    readonly activatedRoute = inject(ActivatedRoute);
    readonly databaseService = inject(DatabaseService);
    searchTerm = '';
    filters = {
        live: true,
        movie: true,
        series: true,
    };
    isGlobalSearch = false;
    private searchSubject = new Subject<string>();
    private readonly DEBOUNCE_TIME = 300;

    constructor(
        @Optional() @Inject(MAT_DIALOG_DATA) private data: SearchResultsData,
        @Optional() public dialogRef: MatDialogRef<SearchResultsComponent>
    ) {
        this.isGlobalSearch = data?.isGlobalSearch || false;

        this.searchSubject
            .pipe(debounceTime(this.DEBOUNCE_TIME))
            .subscribe(() => {
                this.executeSearch();
            });
    }

    ngAfterViewInit() {
        this.xtreamStore.setSelectedContentType(undefined);
        setTimeout(() => {
            this.searchInput.nativeElement.focus();
        });
    }

    onSearch() {
        if (this.searchTerm.length >= 3) {
            this.searchSubject.next(this.searchTerm);
        } else {
            this.xtreamStore.resetSearchResults();
        }
    }

    private executeSearch() {
        const types = Object.entries(this.filters)
            .filter(([_, enabled]) => enabled)
            .map(([type]) => type);

        if (this.isGlobalSearch) {
            this.searchGlobal(this.searchTerm, types);
        } else {
            this.xtreamStore.searchContent({
                term: this.searchTerm,
                types,
            });
        }
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

    ngOnDestroy() {
        this.searchSubject.complete();
    }

    selectItem(
        item: XtreamItem & { playlist_id?: string; playlist_name?: string }
    ) {
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
            const type = item.type === 'movie' ? 'vod' : item.type;
            this.xtreamStore.resetSearchResults();
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
