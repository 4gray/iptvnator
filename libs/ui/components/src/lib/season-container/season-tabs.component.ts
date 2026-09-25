import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslateModule } from '@ngx-translate/core';
import { ExpandableTextComponent } from '../expandable-text/expandable-text.component';

/** Above this count the pill row becomes a dropdown selector. */
const MAX_SEASON_PILLS = 6;

/**
 * Season selector for the season container: a pill row ("Season 1 · 2 · 3")
 * for up to 6 seasons, a dropdown beyond that. Shows an optional season
 * description under the tabs and a "back to playing episode" chip when the
 * currently playing episode belongs to a different season.
 *
 * The dropdown carries season thumbnails (`seasonPosters`): a small poster at
 * the start of each menu row and, for the selected season, in the closed
 * trigger — a long menu of "Season 7 … Season 14" rows reads far faster with
 * a picture per row. The pill row deliberately stays text-only: a thumbnail
 * per pill turns a compact tab strip into a second poster rail. A season
 * without a poster simply has no thumbnail (no placeholder tile), and a
 * poster whose image request fails is dropped rather than left as a
 * broken-image frame.
 */
@Component({
    selector: 'app-season-tabs',
    templateUrl: './season-tabs.component.html',
    styleUrls: ['./season-tabs.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ExpandableTextComponent, MatIcon, MatMenuModule, TranslateModule],
})
export class SeasonTabsComponent {
    /** Season keys, already sorted in display order. */
    readonly seasonKeys = input.required<string[]>();
    readonly selectedSeason = input<string | undefined>(undefined);
    readonly episodeCounts = input<Record<string, number>>({});
    readonly watchedCounts = input<Record<string, number>>({});
    /** Description of the selected season (TMDB/provider), if available. */
    readonly seasonDescription = input<string | null>(null);
    /** Season key of the episode currently playing inline, if any. */
    readonly playingSeasonKey = input<string | null>(null);
    /**
     * Per-season poster URLs keyed by season key, rendered as thumbnails in
     * the dropdown only (menu rows + the selected season's trigger).
     */
    readonly seasonPosters = input<Readonly<Record<string, string>> | null>(
        null
    );

    readonly seasonSelected = output<string>();
    readonly backToPlayingRequested = output<void>();

    readonly useDropdown = computed(
        () => this.seasonKeys().length > MAX_SEASON_PILLS
    );

    readonly showBackToPlaying = computed(() => {
        const playing = this.playingSeasonKey();
        return playing !== null && playing !== this.selectedSeason();
    });

    /** Poster URLs whose image request failed; their thumbnail is dropped. */
    private readonly failedPosters = signal<ReadonlySet<string>>(new Set());

    /** Thumbnail shown in the closed dropdown trigger. */
    readonly selectedPosterUrl = computed(() => {
        const selected = this.selectedSeason();
        return selected === undefined ? null : this.posterUrlOf(selected);
    });

    posterUrlOf(seasonKey: string): string | null {
        const url = this.seasonPosters()?.[seasonKey];
        return url && !this.failedPosters().has(url) ? url : null;
    }

    onPosterError(url: string): void {
        this.failedPosters.update((failed) => new Set(failed).add(url));
    }

    isSeasonCompleted(seasonKey: string): boolean {
        const total = this.episodeCounts()[seasonKey] ?? 0;
        return total > 0 && (this.watchedCounts()[seasonKey] ?? 0) >= total;
    }

    selectSeason(seasonKey: string): void {
        if (seasonKey !== this.selectedSeason()) {
            this.seasonSelected.emit(seasonKey);
        }
    }
}
