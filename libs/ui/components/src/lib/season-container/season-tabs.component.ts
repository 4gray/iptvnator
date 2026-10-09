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

/** Up to this many seasons the picker is a row of chips, beyond it a menu. */
const MAX_SEASON_CHIPS = 4;

/** A season whose episodes are not in yet: `loading` now, `unloaded` until asked. */
export type SeasonCountLoadState = 'loading' | 'unloaded';

/**
 * Season selector for the season container: a chip row ("Season 1 · 2 · 3")
 * for up to 4 seasons, a menu button beyond that, and a "back to playing
 * episode" chip when the currently playing episode belongs to a different
 * season. The threshold is the season count, not the available width.
 *
 * Neither form shows a season poster: the chips are a compact tab strip and
 * the menu rows carry "N episodes · M watched" instead, which tells a long
 * run of "Season 7 … Season 14" apart better than a column of near-identical
 * thumbnails.
 */
@Component({
    selector: 'app-season-tabs',
    templateUrl: './season-tabs.component.html',
    styleUrls: ['./season-tabs.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIcon, MatMenuModule, TranslateModule],
})
export class SeasonTabsComponent {
    /** Season keys, already sorted in display order. */
    readonly seasonKeys = input.required<string[]>();
    readonly selectedSeason = input<string | undefined>(undefined);
    readonly episodeCounts = input<Record<string, number>>({});
    readonly watchedCounts = input<Record<string, number>>({});
    /**
     * Seasons whose episode list is still a portal request away (lazy
     * Stalker VOD): their count is unknown, not zero, so the menu row shows
     * none until the portal answers.
     */
    readonly seasonLoadStates = input<Readonly<
        Record<string, SeasonCountLoadState>
    > | null>(null);
    /** Season key of the episode currently playing inline, if any. */
    readonly playingSeasonKey = input<string | null>(null);

    readonly seasonSelected = output<string>();
    readonly backToPlayingRequested = output<void>();

    readonly useDropdown = computed(
        () => this.seasonKeys().length > MAX_SEASON_CHIPS
    );

    readonly showBackToPlaying = computed(() => {
        const playing = this.playingSeasonKey();
        return playing !== null && playing !== this.selectedSeason();
    });

    /** False while the season's episode list is still on its way. */
    isCountKnown(seasonKey: string): boolean {
        return !this.seasonLoadStates()?.[seasonKey];
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
