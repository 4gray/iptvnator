import { InjectionToken, Signal, signal, WritableSignal } from '@angular/core';
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
 * How many times one resume target may ask the portal for the lazy season
 * it lives in.
 *
 * A failed fetch flips the season's `isLoading` back and leaves it
 * unloaded, which re-runs the effect that asked — so releasing the claim on
 * every failure would hammer a portal that is simply down, while holding it
 * forever strands the handoff after a single transient error. Two attempts
 * buys the recovery and then stops: the detail is open either way, and its
 * "Resume episode" button hydrates the same season on demand.
 */
export const MAX_RESUME_SEASON_HYDRATION_ATTEMPTS = 2;

/**
 * The lazy-season hydration a resume target has asked for, so the owning
 * effect can tell "already in flight" from "failed, may try once more" from
 * "given up". Scoped to one series view; a different target starts fresh.
 */
export class StalkerResumeSeasonHydration {
    /**
     * A signal, not a plain field: nothing else changes when a fetch fails
     * (the season's own `isLoading` has already flipped back by then), so a
     * reader effect would never re-run to spend the retry.
     */
    private readonly claim: WritableSignal<{
        key: string;
        attempts: number;
        pending: boolean;
    } | null> = signal(null);

    /** May this target request its season now? */
    canRequest(key: string): boolean {
        const claim = this.claim();
        if (!claim || claim.key !== key) {
            return true;
        }
        return (
            !claim.pending &&
            claim.attempts < MAX_RESUME_SEASON_HYDRATION_ATTEMPTS
        );
    }

    /** Claim the request before dispatching it. */
    begin(key: string): void {
        const claim = this.claim();
        const attempts = claim?.key === key ? claim.attempts : 0;
        this.claim.set({ key, attempts: attempts + 1, pending: true });
    }

    /**
     * Record how the request ended. A late settlement for a target that is
     * no longer the one being hydrated is ignored, so it cannot hand a
     * retry to whatever claimed the slot after it.
     */
    settle(key: string, answered: boolean): void {
        const claim = this.claim();
        if (!claim || claim.key !== key) {
            return;
        }
        this.claim.set({
            key,
            attempts: answered
                ? MAX_RESUME_SEASON_HYDRATION_ATTEMPTS
                : claim.attempts,
            pending: false,
        });
    }
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
