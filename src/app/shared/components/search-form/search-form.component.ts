import {
    Component,
    ElementRef,
    EventEmitter,
    Input,
    model,
    Output,
    ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

export interface SearchFilters {
    [key: string]: boolean;
}

export interface SearchFilter {
    key: string;
    label: string;
    translationKey?: string;
}

@Component({
    selector: 'app-search-form',
    standalone: true,
    imports: [
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        MatCheckboxModule,
        TranslatePipe,
    ],
    templateUrl: './search-form.component.html',
    styles: [
        `
            .search-container {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
        `,
    ],
})
export class SearchFormComponent {
    @ViewChild('searchInput') searchInput!: ElementRef;
    @Input() placeholder = 'Search';
    @Input() filters: SearchFilters = {};
    @Input() filterConfig: SearchFilter[] = [];
    @Input() singleSelection = false; // Add this new input
    searchTerm = model<string>('');

    @Output() filtersChange = new EventEmitter<SearchFilters>();
    @Output() search = new EventEmitter<void>();

    onFilterChange(changedKey: string) {
        if (this.singleSelection) {
            // Reset all other filters when in single selection mode
            Object.keys(this.filters).forEach((key) => {
                if (key !== changedKey) {
                    this.filters[key] = false;
                }
            });
        }
        this.filtersChange.emit(this.filters);
        this.search.emit();
    }

    onSearchTermChange() {
        setTimeout(() => {
            this.searchTerm.set(this.searchInput.nativeElement.value);
        }, 500);
    }

    focusSearchInput() {
        this.searchInput.nativeElement.focus();
    }
}
