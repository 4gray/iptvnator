import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    afterRenderEffect,
    computed,
    input,
    linkedSignal,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { SeasonTabsComponent } from '@iptvnator/ui/components';
import type {
    FullscreenEpisodePanelItem,
    FullscreenEpisodePanelSeason,
} from './fullscreen-episode-panel.util';

/**
 * Body of the fullscreen side panel during series playback: the season tabs
 * of the detail page on top, the selected season's episodes underneath.
 *
 * Purely presentational. The inline player stamps it into the panel through
 * `FULLSCREEN_CHANNEL_PANEL`, builds the seasons and relays a click to the
 * host's inline episode flow — the same path the Up Next rail uses, so an
 * episode chosen here keeps fullscreen exactly like a "next episode" does.
 * A season tab click is relayed too, so a host that fetches seasons lazily
 * (Stalker VOD series) or enriches them on demand (TMDB stills) runs the
 * same hook the detail page's tabs run.
 *
 * The selected tab follows the playing episode's season and resets to it
 * whenever playback moves to another season; a tab the user picks holds
 * until then. Opening the panel scrolls the playing row into view.
 */
@Component({
    selector: 'app-fullscreen-episode-panel',
    templateUrl: './fullscreen-episode-panel.component.html',
    styleUrl: './fullscreen-episode-panel.component.scss',
    imports: [
        MatIconModule,
        MatProgressSpinnerModule,
        SeasonTabsComponent,
        TranslateModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FullscreenEpisodePanelComponent {
    readonly seasons = input.required<FullscreenEpisodePanelSeason[]>();
    /** The panel is slid in; the playing row is brought into view on the rise. */
    readonly open = input(false);

    readonly seasonSelected = output<string>();
    readonly episodeSelected = output<FullscreenEpisodePanelItem>();

    /**
     * Stills whose image request failed. A provider URL that 404s (or an
     * offline machine) must not leave a broken-image frame: the row falls
     * back to the numeral tile it would have had without a still.
     */
    readonly failedStills = signal<ReadonlySet<number>>(new Set());

    private readonly list = viewChild<ElementRef<HTMLElement>>('list');

    readonly seasonKeys = computed(() => this.seasons().map(({ key }) => key));
    /** `[seasonKey, episodeId]` of the playing row; primitives, so the scroll
     * effect below re-runs on a real change only, not on every rebuild of the
     * season objects a progress tick causes. */
    private readonly playingRow = computed<[string, number] | null>(() => {
        for (const season of this.seasons()) {
            const playing = season.episodes.find((e) => e.isPlaying);
            if (playing) {
                return [season.key, playing.id];
            }
        }
        return null;
    });
    readonly playingSeasonKey = computed(() => this.playingRow()?.[0] ?? null);
    private readonly playingEpisodeId = computed(
        () => this.playingRow()?.[1] ?? null
    );
    /**
     * The user's pick holds until the playing season changes, when the tab
     * jumps back to the episode on screen (autoplay into a new season).
     */
    readonly selectedSeasonKey = linkedSignal<string | null>(
        () => this.playingSeasonKey() ?? this.seasonKeys()[0] ?? null
    );
    readonly selectedSeason = computed<FullscreenEpisodePanelSeason | null>(
        () => {
            const seasons = this.seasons();
            const selected = this.selectedSeasonKey();
            return (
                seasons.find((season) => season.key === selected) ??
                seasons[0] ??
                null
            );
        }
    );
    private readonly shownSeasonKey = computed(
        () => this.selectedSeason()?.key ?? null
    );
    readonly episodeCounts = computed(() =>
        countBySeason(this.seasons(), (season) => season.episodes.length)
    );
    readonly watchedCounts = computed(() =>
        countBySeason(
            this.seasons(),
            (season) =>
                season.episodes.filter((episode) => episode.watched).length
        )
    );

    constructor() {
        // Re-runs when the panel opens, the shown season changes, or playback
        // moves to another episode — never on a mere progress update, which
        // would yank a list the user is scrolling back to the playing row.
        afterRenderEffect(() => {
            const open = this.open();
            const shown = this.shownSeasonKey();
            const playing = this.playingSeasonKey();
            this.playingEpisodeId();
            if (!open || shown === null || shown !== playing) {
                return;
            }
            untracked(() => this.scrollPlayingRowIntoView());
        });
    }

    onSeasonSelected(seasonKey: string): void {
        this.selectedSeasonKey.set(seasonKey);
        this.seasonSelected.emit(seasonKey);
    }

    /**
     * A season the portal never answered for (its request failed): the tabs
     * do not re-emit an already selected key, so the state row offers the
     * retry, which runs the host's selection hook again.
     */
    retrySeason(seasonKey: string): void {
        this.seasonSelected.emit(seasonKey);
    }

    backToPlaying(): void {
        const playing = this.playingSeasonKey();
        if (playing !== null) {
            this.selectedSeasonKey.set(playing);
        }
    }

    onStillError(item: FullscreenEpisodePanelItem): void {
        this.failedStills.update((failed) => new Set(failed).add(item.id));
    }

    hasStill(item: FullscreenEpisodePanelItem): boolean {
        return item.thumbnailUrl !== null && !this.failedStills().has(item.id);
    }

    onEpisodeClick(item: FullscreenEpisodePanelItem): void {
        if (item.isPlaying) {
            return;
        }
        this.episodeSelected.emit(item);
    }

    /**
     * Centers the playing row in the list's own scroll box. Written as
     * `scrollTop` math rather than `scrollIntoView` so nothing outside the
     * list — the fullscreen stage, the page — is ever scrolled with it.
     */
    private scrollPlayingRowIntoView(): void {
        const list = this.list()?.nativeElement;
        const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
        if (!list || !row) {
            return;
        }
        list.scrollTop = Math.max(
            0,
            row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2
        );
    }
}

function countBySeason(
    seasons: readonly FullscreenEpisodePanelSeason[],
    count: (season: FullscreenEpisodePanelSeason) => number
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const season of seasons) {
        counts[season.key] = count(season);
    }
    return counts;
}
