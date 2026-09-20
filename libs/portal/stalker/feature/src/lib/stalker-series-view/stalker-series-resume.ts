import { InjectionToken, Signal, signal } from '@angular/core';
import type { SeriesResumeTarget } from '@iptvnator/portal/shared/util';
import {
    getVodSeriesSeasonNumber,
    type StalkerMappedEpisode,
    type VodSeriesSeasonVm,
} from '@iptvnator/portal/stalker/data-access';
import type { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';

/**
 * One-shot "resume this episode" handoff for a Stalker series, the
 * counterpart of `XTREAM_SERIES_RESUME_TARGET`. Provided by the collection
 * detail host that received the target through the global-recent inline
 * detail state (dashboard hero CTA, Continue Watching ⋮ → Resume); the
 * catalog route never provides it and falls back to the null signal.
 */
export const STALKER_SERIES_RESUME_TARGET = new InjectionToken<
    Signal<SeriesResumeTarget | null>
>('STALKER_SERIES_RESUME_TARGET', {
    factory: () => signal(null),
});

/** Identity of one handoff, so a target is consumed at most once per series. */
export function stalkerSeriesResumeKey(
    playlistId: string,
    target: SeriesResumeTarget
): string {
    return [
        playlistId,
        target.seriesXtreamId,
        target.contentXtreamId,
        target.seasonNumber,
        target.episodeNumber,
    ].join(':');
}

/**
 * The mapped episode a resume target names, or null while it is not on the
 * page yet (lazy VOD season not hydrated) or does not exist.
 *
 * The exact tracking id wins — for lazy VOD that is the scoped id the
 * position row was saved under — then the pre-scope legacy id, then the
 * season/episode coordinates, which also cover embedded-VOD rows whose
 * tracking id derives from the command string.
 */
export function resolveStalkerResumeEpisode(options: {
    target: SeriesResumeTarget;
    episodesBySeason: Readonly<Record<string, readonly XtreamSerieEpisode[]>>;
}): XtreamSerieEpisode | null {
    const { target } = options;
    const episodes: StalkerMappedEpisode[] = [];
    for (const seasonEpisodes of Object.values(options.episodesBySeason)) {
        episodes.push(...(seasonEpisodes as StalkerMappedEpisode[]));
    }

    return (
        episodes.find(
            (episode) => Number(episode.id) === target.contentXtreamId
        ) ??
        episodes.find(
            (episode) => episode.legacyTrackingId === target.contentXtreamId
        ) ??
        episodes.find(
            (episode) =>
                Number(episode.episode_num) === target.episodeNumber &&
                (Number(episode.season) === target.seasonNumber ||
                    episode.providerSeasonNumber === target.seasonNumber)
        ) ??
        null
    );
}

/**
 * For a lazy Ministra VOD series: the not-yet-hydrated season the target
 * lives in, so the host can fetch it before the episode can be resolved.
 * Null once that season is loaded, loading, or unknown.
 */
export function findStalkerResumeLazySeason(options: {
    target: SeriesResumeTarget;
    seasons: ReadonlyArray<VodSeriesSeasonVm>;
}): VodSeriesSeasonVm | null {
    const { target, seasons } = options;
    return (
        seasons.find(
            (season) =>
                !season.episodesLoaded &&
                !season.isLoading &&
                season.episodes.length === 0 &&
                getVodSeriesSeasonNumber(season, seasons) ===
                    target.seasonNumber
        ) ?? null
    );
}
