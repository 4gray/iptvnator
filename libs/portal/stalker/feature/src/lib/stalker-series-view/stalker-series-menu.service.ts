import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { DownloadsService, SettingsStore } from '@iptvnator/services';
import {
    VideoPlayer,
    type ExternalPlayerName,
} from '@iptvnator/shared/interfaces';
import {
    buildSeriesMenuSections,
    SERIES_MENU_ACTION,
    type SeasonContainerComponent,
    type VodMoreMenuSection,
} from '@iptvnator/ui/components';
import type { StalkerQuickStartButton } from './stalker-series-quick-start';

interface StalkerSeriesMenuBindings {
    readonly quickStart: Signal<StalkerQuickStartButton | null>;
    readonly seasonContainer: Signal<SeasonContainerComponent | undefined>;
    readonly hasProgress: Signal<boolean>;
    /** An episode plays or launches: its next tick would undo a reset. */
    readonly playbackActive: Signal<boolean>;
    readonly resetProgress: () => Promise<void>;
    readonly openExternal: (player: ExternalPlayerName) => Promise<void>;
}

/**
 * The "…" menu of the Stalker series page. The portal resolves stream URLs
 * on demand, so "Copy stream URL" and the category row are not offered.
 */
@Injectable()
export class StalkerSeriesMenuService {
    private readonly downloadsService = inject(DownloadsService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly bindings = signal<StalkerSeriesMenuBindings | null>(null);

    bind(bindings: StalkerSeriesMenuBindings): void {
        this.bindings.set(bindings);
    }

    readonly externalPlayer = computed<ExternalPlayerName>(() =>
        this.settingsStore.player() === VideoPlayer.VLC ? 'vlc' : 'mpv'
    );

    readonly sections = computed<VodMoreMenuSection[]>(() => {
        const container = this.bindings()?.seasonContainer();
        const watch = container?.watchPresenter;
        const download = container?.downloadPresenter;
        const quickStart = this.bindings()?.quickStart() ?? null;
        return buildSeriesMenuSections({
            seasonWatchVisible: watch?.seasonWatchToggleVisible() ?? false,
            seasonFullyWatched: watch?.selectedSeasonFullyWatched() ?? false,
            seasonEligibleCount: watch?.seasonWatchEligibleCount() ?? 0,
            seasonActionDisabled:
                (container?.seasonWatchBatchRunning() ?? false) ||
                (!(watch?.selectedSeasonFullyWatched() ?? false) &&
                    (watch?.seasonWatchEligibleCount() ?? 0) === 0),
            seriesMenuVisible: watch?.seriesMenuVisible() ?? false,
            seriesFullyWatched: watch?.seriesFullyWatched() ?? false,
            seriesEligibleCount: watch?.seriesWatchEligibleCount() ?? 0,
            seriesCountKnown: watch?.seriesCountKnown() ?? true,
            seriesActionDisabled: watch?.seriesActionDisabled() ?? true,
            hasProgress: this.bindings()?.hasProgress() ?? false,
            playbackActive: this.bindings()?.playbackActive() ?? false,
            sourcesCount: 0,
            externalPlayerHint:
                quickStart?.action && this.downloadsService.isAvailable()
                    ? this.externalPlayer() === 'vlc'
                        ? 'VLC'
                        : 'MPV'
                    : null,
            copyUrlEpisodeCode: null,
            downloadVisible: download?.presentationVisible() ?? false,
            downloadCount: download?.eligibleEpisodeCount() ?? 0,
            downloadDisabled: download?.seasonDisabled() ?? true,
            downloadBusy: download?.batchRunning() ?? false,
            categoryName: null,
            inContinueWatching: false,
        });
    });

    async run(actionId: string): Promise<void> {
        const container = this.bindings()?.seasonContainer();
        switch (actionId) {
            case SERIES_MENU_ACTION.SeasonWatched:
                container?.watchPresenter.toggleSeasonWatched();
                return;
            case SERIES_MENU_ACTION.SeriesWatched:
                container?.watchPresenter.toggleSeriesWatched();
                return;
            case SERIES_MENU_ACTION.ResetProgress:
                await this.bindings()?.resetProgress();
                return;
            case SERIES_MENU_ACTION.DownloadSeason:
                await container?.downloadPresenter.enqueueSeason();
                return;
            case SERIES_MENU_ACTION.ExternalPlayer:
                await this.bindings()?.openExternal(this.externalPlayer());
                return;
        }
    }
}
