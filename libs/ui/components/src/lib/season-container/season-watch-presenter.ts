import { Injectable, type Signal, computed, signal } from '@angular/core';
import { createLogger } from '@iptvnator/portal/shared/util';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import {
    type SeasonContainerSeasonPlaybackToggleRequest,
    type SeasonContainerSeriesPlaybackToggleRequest,
    buildSeasonWatchToggleRequest,
    buildSeriesWatchToggleRequest,
    listMarkableEpisodes,
} from './season-watch-toggle.util';

export interface SeasonWatchPresenterSources {
    readonly seasons: Signal<Record<string, XtreamSerieEpisode[]>>;
    readonly selectedSeason: Signal<string | undefined>;
    readonly selectedSeasonEpisodes: Signal<readonly XtreamSerieEpisode[]>;
    readonly seriesId: Signal<number>;
    readonly playlistId: Signal<string>;
    /**
     * True while some seasons exist whose episode lists are not loaded yet
     * (Stalker lazy-VOD). Blocks the "fully watched" verdict and switches the
     * series label to its countless variant.
     */
    readonly hasUnloadedSeasons: Signal<boolean>;
    readonly batchRunning: Signal<boolean>;
    readonly playingEpisodeId: Signal<number | null>;
    readonly activeEpisodeId: Signal<number | null>;
    readonly openingEpisodeId: Signal<number | null>;
    readonly isEpisodeWatched: (episode: XtreamSerieEpisode) => boolean;
    readonly emitSeasonToggle: (
        request: SeasonContainerSeasonPlaybackToggleRequest
    ) => void;
    readonly emitSeriesToggle: (
        request: SeasonContainerSeriesPlaybackToggleRequest
    ) => void;
}

/**
 * Watched-toggle state for the season header, extracted from
 * `SeasonContainerComponent` (which sits at the max-lines cap): the
 * season-scoped bulk toggle plus the series-scoped menu action.
 */
@Injectable()
export class SeasonWatchPresenter {
    private readonly logger = createLogger('SeasonWatchPresenter');
    private readonly sources = signal<SeasonWatchPresenterSources | null>(
        null
    );

    connect(sources: SeasonWatchPresenterSources): void {
        this.sources.set(sources);
    }

    readonly selectedSeasonUnwatchedCount = computed(() => {
        const sources = this.sources();
        if (!sources) {
            return 0;
        }
        return sources
            .selectedSeasonEpisodes()
            .filter((episode) => !sources.isEpisodeWatched(episode)).length;
    });

    readonly selectedSeasonFullyWatched = computed(() => {
        const sources = this.sources();
        return (
            !!sources &&
            sources.selectedSeasonEpisodes().length > 0 &&
            this.selectedSeasonUnwatchedCount() === 0
        );
    });

    /**
     * The episode currently playing (inline or externally) or launching is
     * never bulk-marked: the player persists its live position and would
     * immediately overwrite the full-progress row.
     */
    private readonly watchExcludedIds = computed(() => {
        const sources = this.sources();
        if (!sources) {
            return new Set<number>();
        }
        const ids = [
            sources.playingEpisodeId(),
            sources.activeEpisodeId(),
            sources.openingEpisodeId(),
        ].filter((id): id is number => id !== null);
        return new Set(ids);
    });

    /** Count shown in the season toggle label: episodes the action touches. */
    readonly seasonWatchEligibleCount = computed(() => {
        const sources = this.sources();
        if (!sources) {
            return 0;
        }
        return this.selectedSeasonFullyWatched()
            ? sources.selectedSeasonEpisodes().length
            : listMarkableEpisodes(
                  sources.selectedSeasonEpisodes(),
                  sources.isEpisodeWatched,
                  this.watchExcludedIds()
              ).length;
    });

    readonly seasonWatchToggleVisible = computed(() => {
        const sources = this.sources();
        return (
            !!sources &&
            Object.keys(sources.seasons()).length > 0 &&
            sources.selectedSeasonEpisodes().length > 0 &&
            !!sources.playlistId()
        );
    });

    toggleSeasonWatched(): void {
        const sources = this.sources();
        if (!sources) {
            return;
        }
        const seasonKey = sources.selectedSeason();
        const playlistId = sources.playlistId();
        if (!seasonKey || !playlistId) {
            this.logger.warn(
                'Cannot toggle season watched: no season/playlist'
            );
            return;
        }
        if (sources.batchRunning()) {
            return;
        }

        const request = buildSeasonWatchToggleRequest({
            episodes: sources.selectedSeasonEpisodes(),
            seasonKey,
            seriesId: sources.seriesId(),
            playlistId,
            isEpisodeWatched: sources.isEpisodeWatched,
            excludedEpisodeIds: this.watchExcludedIds(),
        });
        if (request) {
            sources.emitSeasonToggle(request);
        }
    }

    private readonly loadedEpisodes = computed(() => {
        const sources = this.sources();
        const episodes: XtreamSerieEpisode[] = [];
        if (!sources) {
            return episodes;
        }
        for (const seasonEpisodes of Object.values(sources.seasons())) {
            episodes.push(...(seasonEpisodes ?? []));
        }
        return episodes;
    });

    /** False while unloaded seasons make any series-wide count a guess. */
    readonly seriesCountKnown = computed(
        () => !(this.sources()?.hasUnloadedSeasons() ?? false)
    );

    /**
     * Only a series whose every season is loaded and watched flips the action
     * to unwatch-all; unloaded seasons keep the direction at "mark".
     */
    readonly seriesFullyWatched = computed(() => {
        const sources = this.sources();
        if (!sources || sources.hasUnloadedSeasons()) {
            return false;
        }
        const episodes = this.loadedEpisodes();
        return (
            episodes.length > 0 &&
            episodes.every((episode) => sources.isEpisodeWatched(episode))
        );
    });

    /** Count shown in the series action label: episodes the action touches. */
    readonly seriesWatchEligibleCount = computed(() => {
        const sources = this.sources();
        if (!sources) {
            return 0;
        }
        return this.seriesFullyWatched()
            ? this.loadedEpisodes().length
            : listMarkableEpisodes(
                  this.loadedEpisodes(),
                  sources.isEpisodeWatched,
                  this.watchExcludedIds()
              ).length;
    });

    readonly seriesMenuVisible = computed(() => {
        const sources = this.sources();
        if (
            !sources ||
            !sources.playlistId() ||
            Object.keys(sources.seasons()).length === 0
        ) {
            return false;
        }
        return (
            this.loadedEpisodes().length > 0 || sources.hasUnloadedSeasons()
        );
    });

    readonly seriesActionDisabled = computed(() => {
        const sources = this.sources();
        if (!sources) {
            return true;
        }
        return (
            sources.batchRunning() ||
            !(
                this.seriesFullyWatched() ||
                this.seriesWatchEligibleCount() > 0 ||
                sources.hasUnloadedSeasons()
            )
        );
    });

    toggleSeriesWatched(): void {
        const sources = this.sources();
        if (!sources) {
            return;
        }
        const playlistId = sources.playlistId();
        if (!playlistId) {
            this.logger.warn('Cannot toggle series watched: no playlist');
            return;
        }
        if (sources.batchRunning()) {
            return;
        }

        // The direction the label advertised, never re-inferred at persist
        // time: with every loaded episode watched but seasons still unloaded
        // the label says "mark", while inference over loaded data would flip
        // to an unwatch.
        const markWatched = !this.seriesFullyWatched();
        const request = buildSeriesWatchToggleRequest({
            seasons: sources.seasons(),
            seriesId: sources.seriesId(),
            playlistId,
            isEpisodeWatched: sources.isEpisodeWatched,
            excludedEpisodeIds: this.watchExcludedIds(),
            markWatched,
        });
        if (request) {
            sources.emitSeriesToggle(request);
            return;
        }
        // No loaded target but unloaded seasons remain: emit an empty mark
        // request so the host can hydrate the missing seasons and rebuild.
        if (markWatched && sources.hasUnloadedSeasons()) {
            sources.emitSeriesToggle({ markWatched: true, requests: [] });
        }
    }
}
