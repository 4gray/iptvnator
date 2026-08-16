import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import {
    TitleResultItem,
    TitleResultsComponent,
    TitleResultsScope,
} from '../title-results/title-results.component';
import { DiscoverRouteParams } from './discover-params';

/**
 * Discover page shell: facet header ("Movies · Drama · 1990") over the
 * shared title-results grid. Same surface as the actor page minus the
 * person profile.
 */
@Component({
    selector: 'app-discover-view',
    imports: [
        MatIcon,
        MatProgressSpinnerModule,
        TranslatePipe,
        TitleResultsComponent,
    ],
    templateUrl: './discover-view.component.html',
    styleUrls: ['./discover-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoverViewComponent<T extends TitleResultItem> {
    readonly facets = input.required<DiscoverRouteParams>();
    readonly items = input<T[]>([]);
    readonly isLoading = input(false);
    /** Cross-playlist matching in flight (All-portals scope) */
    readonly isMatching = input(false);
    /** Shows the all/in-library filter (portals with a local catalog) */
    readonly showAvailabilityFilter = input(false);
    /** Shows the this-portal/all-portals scope switch (Electron only) */
    readonly showScopeToggle = input(false);
    readonly scope = input<TitleResultsScope>('portal');

    readonly itemClicked = output<T>();
    readonly backClicked = output<void>();
    readonly scopeChanged = output<TitleResultsScope>();

    readonly mediaTypeLabelKey = computed(() =>
        this.facets().type === 'tv'
            ? 'XTREAM.DISCOVER_SERIES'
            : 'XTREAM.DISCOVER_MOVIES'
    );

    /** Facet labels rendered as header chips, filter-value order */
    readonly facetLabels = computed<string[]>(() => {
        const facets = this.facets();
        return [
            facets.genreLabel,
            facets.year !== null ? String(facets.year) : null,
            facets.countryLabel ?? facets.countryCode,
        ].filter((label): label is string => label !== null);
    });
}
