import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
    signal,
} from '@angular/core';
import type { SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';

@Component({
    selector: 'app-season-container',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.Eager,
    template: '<div data-testid="season-container"></div>',
})
export class StubSeasonContainerComponent {
    readonly seasons = input<unknown>(null);
    readonly hasUnloadedSeasons = input(false);
    readonly seriesId = input<number | string | null>(null);
    readonly playlistId = input('');
    readonly seriesTitle = input<string | undefined>(undefined);
    readonly playbackPositions = input<unknown>(null);
    readonly openingEpisodeId = input<number | null>(null);
    readonly activeEpisodeId = input<number | null>(null);
    readonly playingEpisodeId = input<number | null>(null);
    readonly seasonDescriptions = input<unknown>(null);
    readonly isLoading = input(false);
    readonly downloadsEnabled = input(true);
    readonly downloadAdapter = input<SeasonEpisodeDownloadAdapter | null>(null);
    readonly seasonWatchBatchRunning = input(false);
    readonly seasonSelected = output<string>();
    readonly episodeClicked = output<unknown>();
    readonly playbackToggleRequested = output<unknown>();
    readonly seasonPlaybackToggleRequested = output<unknown>();
    readonly selectedSeason = signal<string | undefined>(undefined);
}

@Component({
    selector: 'app-portal-inline-player',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.Eager,
    template: '',
})
export class StubPortalInlinePlayerComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly playback = input<unknown>(null);
    readonly episodeMetadata = input<unknown>(null);
    readonly seriesTitle = input<string | null>(null);
    readonly seriesNavigation = input<unknown>(null);
    readonly upNextEpisodes = input<unknown>(null);
    readonly timeUpdate = output<unknown>();
    readonly closed = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly externalFallbackRequested = output<unknown>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    readonly upNextEpisodeSelected = output<unknown>();
}

@Component({
    selector: 'app-favorites-button',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.Eager,
    template: '<button class="favorite-btn">favorite</button>',
})
export class StubFavoritesButtonComponent {
    readonly itemId = input<string | number | undefined>(undefined);
    readonly item = input<unknown>(null);
}
