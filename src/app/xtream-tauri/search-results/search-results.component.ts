import {
    AfterViewInit,
    Component,
    ElementRef,
    inject,
    ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router } from '@angular/router';
import { XtreamItem } from '../../../../shared/xtream-item.interface';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-search-results',
    standalone: true,
    imports: [
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        MatCheckboxModule,
        FormsModule,
    ],
    templateUrl: './search-results.component.html',
    styleUrls: ['./search-results.component.scss'],
})
export class SearchResultsComponent implements AfterViewInit {
    @ViewChild('searchInput') searchInput!: ElementRef;
    readonly xtreamStore = inject(XtreamStore);
    readonly router = inject(Router);
    readonly activatedRoute = inject(ActivatedRoute);
    searchTerm = '';
    filters = {
        live: true,
        movie: true,
        series: true,
    };

    ngAfterViewInit() {
        this.xtreamStore.setSelectedContentType(undefined);
        setTimeout(() => {
            this.searchInput.nativeElement.focus();
        });
    }

    onSearch() {
        if (this.searchTerm.length >= 3) {
            const types = Object.entries(this.filters)
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                .filter(([_, enabled]) => enabled)
                .map(([type]) => type);
            this.xtreamStore.searchContent({ term: this.searchTerm, types });
        }
    }

    selectItem(item: XtreamItem) {
        const type = item.type === 'movie' ? 'vod' : item.type;
        this.xtreamStore.resetSearchResults();
        this.xtreamStore.setSelectedContentType(type);

        if (item.type === 'live') {
            this.router.navigate(['..', type, item.category_id], {
                relativeTo: this.activatedRoute,
            });
        } else {
            this.router.navigate(
                ['..', type, item.category_id, item.xtream_id],
                {
                    relativeTo: this.activatedRoute,
                }
            );
        }
    }
}
