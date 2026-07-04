import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
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

    readonly seasonSelected = output<string>();
    readonly backToPlayingRequested = output<void>();

    readonly useDropdown = computed(
        () => this.seasonKeys().length > MAX_SEASON_PILLS
    );

    readonly showBackToPlaying = computed(() => {
        const playing = this.playingSeasonKey();
        return playing !== null && playing !== this.selectedSeason();
    });

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
