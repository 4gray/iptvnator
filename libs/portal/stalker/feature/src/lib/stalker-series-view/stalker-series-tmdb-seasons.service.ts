import { Injectable, inject, signal } from '@angular/core';
import {
    TmdbEnrichmentService,
    mergeEpisodesWithTmdb,
    type TmdbEpisode,
} from '@iptvnator/services';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';

/**
 * Component-scoped holder for lazily fetched TMDB episode data in the
 * Stalker series view (provide it in the component's `providers`).
 *
 * Entries are keyed by `${tmdbId}|${seasonKey}` so data from a previously
 * shown series can never leak into the current one.
 */
@Injectable()
export class StalkerSeriesTmdbSeasonsService {
    private readonly tmdbEnrichment = inject(TmdbEnrichmentService);

    private readonly episodesByKey = signal<
        ReadonlyMap<string, TmdbEpisode[]>
    >(new Map());

    /**
     * Overlays fetched TMDB episode data (real names, overviews, stills)
     * onto provider season maps — a no-op while nothing is fetched.
     * Reads a signal, so callers can use it inside a `computed`.
     */
    overlay(
        seasons: Record<string, XtreamSerieEpisode[]>,
        tmdbId: number | null | undefined
    ): Record<string, XtreamSerieEpisode[]> {
        const fetched = this.episodesByKey();
        if (!tmdbId || fetched.size === 0) {
            return seasons;
        }

        const merged: Record<string, XtreamSerieEpisode[]> = {};
        for (const [seasonKey, episodes] of Object.entries(seasons)) {
            const forSeason = fetched.get(`${tmdbId}|${seasonKey}`);
            merged[seasonKey] = forSeason?.length
                ? mergeEpisodesWithTmdb(episodes, forSeason)
                : episodes;
        }
        return merged;
    }

    /**
     * Lazily pulls the TMDB episode list for an opened season; a no-op
     * without a show-level TMDB match, with enrichment disabled, or when
     * the season was already fetched.
     */
    async fetchSeason(
        tmdbId: number | null | undefined,
        seasonKey: string,
        episodes: XtreamSerieEpisode[] | undefined
    ): Promise<void> {
        if (!tmdbId) {
            return;
        }

        const mapKey = `${tmdbId}|${seasonKey}`;
        if (this.episodesByKey().has(mapKey)) {
            return;
        }

        const seasonNumber = Number(episodes?.[0]?.season ?? seasonKey);
        if (!Number.isFinite(seasonNumber)) {
            return;
        }

        const tmdbEpisodes = await this.tmdbEnrichment.getSeasonEpisodes(
            tmdbId,
            seasonNumber
        );
        if (!tmdbEpisodes?.length) {
            return;
        }

        const next = new Map(this.episodesByKey());
        next.set(mapKey, tmdbEpisodes);
        this.episodesByKey.set(next);
    }
}
