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
import { MatButtonModule } from '@angular/material/button';
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
        MatButtonModule,
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

            .recent-search {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 0 12px;
                height: 42px;
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                background: rgba(255, 255, 255, 0.03);
            }

            .recent-search mat-icon {
                opacity: 0.6;
                font-size: 18px;
                width: 18px;
                height: 18px;
            }

            .recent-search input {
                width: 100%;
                border: 0;
                background: transparent;
                color: inherit;
                font: inherit;
                opacity: 0.95;
            }

            .recent-search input::placeholder {
                opacity: 0.5;
            }

            .clear-btn {
                width: 30px;
                height: 30px;
                min-width: 30px;
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

    clearSearch() {
        this.searchInput.nativeElement.value = '';
        this.searchTerm.set('');
    }

    focusSearchInput() {
        this.searchInput.nativeElement.focus();
    }
}
