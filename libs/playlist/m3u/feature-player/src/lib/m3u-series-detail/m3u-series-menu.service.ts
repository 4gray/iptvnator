import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import {
    buildSeriesMenuSections,
    SERIES_MENU_ACTION,
    type SeasonContainerComponent,
    type VodMoreMenuSection,
} from '@iptvnator/ui/components';

/**
 * The "…" menu of the M3U series page.
 *
 * The shared season grid decides what a season or series watched toggle
 * means, but it has no control that starts one: the host's hero menu does,
 * as on the Xtream and Stalker pages. A playlist has no downloads, no
 * alternative sources and no category page, so only the watched rows are
 * offered.
 */
@Injectable()
export class M3uSeriesMenuService {
    /**
     * Watched marks are positions: where the runtime cannot store them (the
     * browser build), a toggle would vanish on the next load, so none is
     * offered.
     */
    readonly watchControls = inject(PlaybackPositionRuntimeBridgeService)
        .supportsStorage;

    private readonly seasonContainer = signal<Signal<
        SeasonContainerComponent | undefined
    > | null>(null);

    connect(
        seasonContainer: Signal<SeasonContainerComponent | undefined>
    ): void {
        this.seasonContainer.set(seasonContainer);
    }

    readonly sections = computed<VodMoreMenuSection[]>(() => {
        if (!this.watchControls) return [];
        const container = this.seasonContainer()?.();
        const watch = container?.watchPresenter;
        const batchRunning = container?.seasonWatchBatchRunning() ?? false;
        const seasonFullyWatched = watch?.selectedSeasonFullyWatched() ?? false;
        const seasonEligibleCount = watch?.seasonWatchEligibleCount() ?? 0;
        return buildSeriesMenuSections({
            seasonWatchVisible: watch?.seasonWatchToggleVisible() ?? false,
            seasonFullyWatched,
            seasonEligibleCount,
            // A second batch started while the first is in the worker would
            // be computed from positions the first is about to replace.
            seasonActionDisabled:
                batchRunning ||
                (!seasonFullyWatched && seasonEligibleCount === 0),
            seriesMenuVisible: watch?.seriesMenuVisible() ?? false,
            seriesFullyWatched: watch?.seriesFullyWatched() ?? false,
            seriesEligibleCount: watch?.seriesWatchEligibleCount() ?? 0,
            seriesCountKnown: watch?.seriesCountKnown() ?? true,
            seriesActionDisabled: watch?.seriesActionDisabled() ?? true,
            hasProgress: false,
            playbackActive: false,
            startPending: false,
            watchBatchRunning: batchRunning,
            sourcesCount: 0,
            externalPlayerHint: null,
            copyUrlEpisodeCode: null,
            downloadVisible: false,
            downloadCount: 0,
            downloadDisabled: true,
            downloadBusy: false,
            categoryName: null,
            inContinueWatching: false,
        });
    });

    run(actionId: string): void {
        const watch = this.seasonContainer()?.()?.watchPresenter;
        switch (actionId) {
            case SERIES_MENU_ACTION.SeasonWatched:
                watch?.toggleSeasonWatched();
                return;
            case SERIES_MENU_ACTION.SeriesWatched:
                watch?.toggleSeriesWatched();
                return;
        }
    }
}
