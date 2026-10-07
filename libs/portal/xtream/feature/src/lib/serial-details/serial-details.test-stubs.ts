import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import type { SeasonEpisodeDownloadAdapter } from '@iptvnator/portal/shared/data-access';

/** Stand-ins for the heavy children of the series-details page in specs. */

@Component({
    selector: 'app-season-container',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.Eager,
    template: '<div data-testid="season-container"></div>',
})
export class StubSeasonContainerComponent {
    readonly seasons = input<unknown>(null);
    readonly seriesId = input<number | string | null>(null);
    readonly playlistId = input('');
    readonly seriesTitle = input<string | undefined>(undefined);
    readonly playbackPositions = input<unknown>(null);
    readonly downloadAdapter = input<SeasonEpisodeDownloadAdapter | null>(null);
    readonly downloadsEnabled = input(true);
    readonly openingEpisodeId = input<number | null>(null);
    readonly activeEpisodeId = input<number | null>(null);
    readonly playingEpisodeId = input<number | null>(null);
    readonly seasonDescriptions = input<unknown>(null);
    readonly seasonPosters = input<unknown>(null);
    readonly seasonWatchBatchRunning = input(false);
    readonly episodeClicked = output<unknown>();
    readonly playbackToggleRequested = output<unknown>();
    readonly seasonPlaybackToggleRequested = output<unknown>();
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
    readonly seriesEpisodes = input<unknown>(null);
    readonly seasonPosters = input<unknown>(null);
    readonly episodePlaybackPositions = input<unknown>(null);
    readonly seasonLoadStates = input<unknown>(null);
    readonly timeUpdate = output<unknown>();
    readonly closed = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly externalFallbackRequested = output<unknown>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    readonly upNextEpisodeSelected = output<unknown>();
    readonly episodePanelSeasonSelected = output<string>();
}

@Component({
    selector: 'mat-icon',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.Eager,
    template: '<ng-content />',
})
export class StubMatIconComponent {}
