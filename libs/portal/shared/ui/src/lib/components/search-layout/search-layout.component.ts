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
import { InfiniteScrollDirective } from '../../directives/infinite-scroll.directive';
import { SearchFormComponent } from '../search-form/search-form.component';

@Component({
    selector: 'app-search-layout',
    standalone: true,
    imports: [
        InfiniteScrollDirective,
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

    /** Whether to show the back button (nested search reached via navigation) */
    readonly showBackButton = input<boolean>(false);

    /** Whether to show results count */
    readonly showResultsCount = input<boolean>(true);

    /** Whether to show the inline search input */
    readonly showSearchInput = input<boolean>(true);

    /** Whether inline details are active and should replace the search body */
    readonly showDetails = input<boolean>(false);

    /** Minimum characters required for search */
    readonly minSearchLength = input<number>(3);

    /**
     * Whether the consumer can supply more results than are rendered. Drives
     * the results container's infinite scroll: near-end crossings and the
     * measured auto-fill (which reveals further chunks even when the current
     * ones do not overflow a tall viewport) both emit `nearEnd` only while
     * this is true. Defaults to true, matching the historical unconditional
     * `nearEnd` emission for consumers that manage their own guards.
     */
    readonly nearEndHasMore = input<boolean>(true);

    /** True while the consumer is appending; suppresses further triggers. */
    readonly nearEndAppending = input<boolean>(false);

    /**
     * Number of currently RENDERED results — the infinite scroll re-measures
     * overflow when this changes, so it must grow with the revealed window.
     * `resultsCount` cannot serve here: it is the total result-set size and
     * stays constant while a consumer reveals chunks of it, which would stop
     * the auto-fill after the first chunk. Defaults to `resultsCount` for
     * consumers that always render everything they report.
     */
    readonly nearEndRenderedCount = input<number | null>(null);

    /** Initial state description translation key */
    readonly initialDescriptionKey = input<string>(
        'PORTALS.SEARCH_VIEW.INITIAL_DESCRIPTION'
    );

    /** Emitted when search term changes */
    readonly searchTermChange = output<string>();

    /** Emitted when close button is clicked */
    readonly closeClick = output<void>();

    /** Emitted when the back button is clicked */
    readonly backClick = output<void>();

    /**
     * Emitted when more results should be revealed — on scrolling near the
     * bottom and by the auto-fill overflow check (see `InfiniteScrollDirective`
     * on the results container).
     */
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

    onBackClick(): void {
        this.backClick.emit();
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
