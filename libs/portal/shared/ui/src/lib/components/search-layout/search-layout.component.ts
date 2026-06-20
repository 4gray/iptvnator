import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
    viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { SearchFormComponent } from '../search-form/search-form.component';

@Component({
    selector: 'app-search-layout',
    standalone: true,
    imports: [
        MatIcon,
        MatIconButton,
        MatProgressSpinner,
        SearchFormComponent,
        TranslatePipe,
    ],
    templateUrl: './search-layout.component.html',
    styleUrl: './search-layout.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchLayoutComponent {
    private readonly searchFormComponent = viewChild(SearchFormComponent);
    private readonly nearEndThresholdPx = 240;
    private isWithinNearEndThreshold = false;

    /** Page title translation key */
    readonly title = input<string>('PORTALS.SIDEBAR.SEARCH');

    /** Current search term */
    readonly searchTerm = input<string>('');

    /** Number of results found */
    readonly resultsCount = input<number>(0);

    /** Whether search is in progress */
    readonly isLoading = input<boolean>(false);

    /** Whether to show the close button (for dialog mode) */
    readonly showCloseButton = input<boolean>(false);

    /** Whether to show results count */
    readonly showResultsCount = input<boolean>(true);

    /** Whether to show the inline search input */
    readonly showSearchInput = input<boolean>(true);

    /** Whether inline details are active and should replace the search body */
    readonly showDetails = input<boolean>(false);

    /** Minimum characters required for search */
    readonly minSearchLength = input<number>(3);

    /** Initial state description translation key */
    readonly initialDescriptionKey = input<string>(
        'PORTALS.SEARCH_VIEW.INITIAL_DESCRIPTION'
    );

    /** Emitted when search term changes */
    readonly searchTermChange = output<string>();

    /** Emitted when close button is clicked */
    readonly closeClick = output<void>();

    /** Emitted when the scroll container is close to the bottom */
    readonly nearEnd = output<void>();

    /** Focus the search input */
    focusSearchInput(): void {
        this.searchFormComponent()?.focusSearchInput();
    }

    onSearchTermChange(term: string): void {
        this.searchTermChange.emit(term);
    }

    onCloseClick(): void {
        this.closeClick.emit();
    }

    onSearchContentScroll(event: Event): void {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }

        const distanceToBottom =
            target.scrollHeight - target.scrollTop - target.clientHeight;
        const isNearEnd = distanceToBottom <= this.nearEndThresholdPx;

        if (isNearEnd && !this.isWithinNearEndThreshold) {
            this.nearEnd.emit();
        }

        this.isWithinNearEndThreshold = isNearEnd;
    }

    /** Check if we should show the "no results" state */
    get showNoResults(): boolean {
        return (
            this.searchTerm().length >= this.minSearchLength() &&
            this.resultsCount() === 0 &&
            !this.isLoading()
        );
    }

    /** Check if we should show the initial state */
    get showInitialState(): boolean {
        return (
            this.searchTerm().length < this.minSearchLength() &&
            this.resultsCount() === 0 &&
            !this.isLoading()
        );
    }

    /** Check if we should show results */
    get showResults(): boolean {
        return this.resultsCount() > 0 && !this.isLoading();
    }
}
