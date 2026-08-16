import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { ActorCrewJob } from '@iptvnator/services';

/**
 * One entry of the shared title-results grid (actor filmography, Discover
 * results). `available` marks a confident catalog match (direct
 * navigation); the rest open the portal search prefilled with the title.
 */
export interface TitleResultItem {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    year: number | null;
    posterUrl: string | null;
    available: boolean;
    /** Playlist name shown in the badge (All-portals scope) */
    availableIn?: string;
    /** Actor-page extras; absent on Discover results */
    character?: string | null;
    crewJob?: ActorCrewJob | null;
}

export type TitleResultsScope = 'portal' | 'global';

/**
 * TMDB-titles grid with the scope (this portal / all portals) and
 * availability (all / in library) filter chips, shared by the actor and
 * Discover pages. Generic over the item type so hosts get their own item
 * shape back from `itemClicked` without casts. Theme custom properties
 * (`--surface-bg`, `--chip-*`, ...) are expected from the host's scope.
 */
@Component({
    selector: 'app-title-results',
    imports: [MatIcon, MatProgressSpinnerModule, TranslatePipe],
    templateUrl: './title-results.component.html',
    styleUrls: ['./title-results.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleResultsComponent<T extends TitleResultItem> {
    readonly headingKey = input.required<string>();
    readonly items = input<T[]>([]);
    /** Cross-playlist matching in flight (All-portals scope) */
    readonly isMatching = input(false);
    /** Shows the all/in-library filter (portals with a local catalog) */
    readonly showAvailabilityFilter = input(false);
    /** Shows the this-portal/all-portals scope switch (Electron only) */
    readonly showScopeToggle = input(false);
    readonly scope = input<TitleResultsScope>('portal');
    readonly emptyMessageKey = input('XTREAM.ACTOR_NO_RESULTS');

    readonly itemClicked = output<T>();
    readonly scopeChanged = output<TitleResultsScope>();

    readonly filterMode = signal<'all' | 'available'>('all');

    /** Translated label key for a crew-only credit ("Director"/"Creator") */
    crewJobKey(job: ActorCrewJob): string {
        return job === 'Creator'
            ? 'XTREAM.CREW_JOB_CREATOR'
            : 'XTREAM.CREW_JOB_DIRECTOR';
    }

    /**
     * The spinner belongs to the global scope only. Gating the grid on the
     * raw flag hides valid portal results when the user switches back while
     * the worker request is still in flight — a stuck worker would then
     * blank the local grid indefinitely.
     */
    readonly matchingVisible = computed(
        () => this.isMatching() && this.scope() === 'global'
    );

    readonly visibleItems = computed(() =>
        this.showAvailabilityFilter() && this.filterMode() === 'available'
            ? this.items().filter((item) => item.available)
            : this.items()
    );
}
