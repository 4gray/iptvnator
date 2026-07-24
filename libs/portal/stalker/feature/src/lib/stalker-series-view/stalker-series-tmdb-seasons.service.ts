import { Injectable, inject, signal } from '@angular/core';
import {
    TmdbEnrichmentService,
    mergeEpisodesWithTmdb,
    type TmdbEpisode,
} from '@iptvnator/services';
import {
    XtreamSerieEpisode,
    resolveEnrichmentSeasonNumber,
} from '@iptvnator/shared/interfaces';

/**
 * Component-scoped holder for lazily fetched TMDB season data (episode
 * lists and season overviews) in the Stalker series view (provide it in
 * the component's `providers`).
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
    private readonly overviewsByKey = signal<ReadonlyMap<string, string>>(
        new Map()
    );

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
     * Season overviews for the season tabs, keyed by season key of the
     * given show. Reads a signal, so callers can use it in a `computed`.
     */
    descriptions(tmdbId: number | null | undefined): Record<string, string> {
        const overviews = this.overviewsByKey();
        if (!tmdbId || overviews.size === 0) {
            return {};
        }

        const prefix = `${tmdbId}|`;
        const descriptions: Record<string, string> = {};
        for (const [mapKey, overview] of overviews) {
            if (mapKey.startsWith(prefix)) {
                descriptions[mapKey.slice(prefix.length)] = overview;
            }
        }
        return descriptions;
    }

    /**
     * Lazily pulls the TMDB season (episode list + overview) for an opened
     * season; a no-op without a show-level TMDB match, with enrichment
     * disabled, or when the season was already fetched. `context` carries
     * the raw provider title and total season count so a per-season slice
     * ("The Mandalorian (2 season)" with its single season renumbered to 1)
     * fetches the season the title names instead of the provider's number.
     */
    async fetchSeason(
        tmdbId: number | null | undefined,
        seasonKey: string,
        episodes: XtreamSerieEpisode[] | undefined,
        context?: { rawTitle?: string | null; seasonCount?: number }
    ): Promise<void> {
        if (!tmdbId) {
            return;
        }

        const mapKey = `${tmdbId}|${seasonKey}`;
        if (this.episodesByKey().has(mapKey)) {
            return;
        }

        const providerSeasonNumber = Number(episodes?.[0]?.season ?? seasonKey);
        if (!Number.isFinite(providerSeasonNumber)) {
            return;
        }

        const seasonNumber = resolveEnrichmentSeasonNumber({
            rawTitle: context?.rawTitle,
            providerSeasonNumber,
            providerSeasonCount: context?.seasonCount ?? 0,
        });

        const season = await this.tmdbEnrichment.getSeason(
            tmdbId,
            seasonNumber
        );
        if (!season) {
            return;
        }

        if (season.overview) {
            const overviews = new Map(this.overviewsByKey());
            overviews.set(mapKey, season.overview);
            this.overviewsByKey.set(overviews);
        }

        if (!season.episodes?.length) {
            return;
        }

        const next = new Map(this.episodesByKey());
        next.set(mapKey, season.episodes);
        this.episodesByKey.set(next);
    }
}
