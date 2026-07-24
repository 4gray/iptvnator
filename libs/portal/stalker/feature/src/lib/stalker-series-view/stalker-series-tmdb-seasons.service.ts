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

interface FetchedTmdbSeason {
    /** Resolved TMDB season number this entry was fetched for */
    seasonNumber: number;
    episodes: TmdbEpisode[];
}

/**
 * Component-scoped holder for lazily fetched TMDB season data (episode
 * lists and season overviews) in the Stalker series view (provide it in
 * the component's `providers`).
 *
 * Entries are keyed by `${tmdbId}|${seasonKey}` so data from a previously
 * shown series can never leak into the current one, and each entry records
 * the RESOLVED TMDB season it holds: per-season slices of one show share
 * (tmdbId, provider key "1") but resolve to different seasons, and a fetch
 * made with stale navigation context must be overwritten once the real
 * context re-resolves — plain key idempotency would block both.
 */
@Injectable()
export class StalkerSeriesTmdbSeasonsService {
    private readonly tmdbEnrichment = inject(TmdbEnrichmentService);

    private readonly seasonsByKey = signal<
        ReadonlyMap<string, FetchedTmdbSeason>
    >(new Map());
    private readonly overviewsByKey = signal<ReadonlyMap<string, string>>(
        new Map()
    );
    /** mapKey → season number currently being fetched (in-flight dedup) */
    private readonly pending = new Map<string, number>();

    /**
     * Overlays fetched TMDB episode data (real names, overviews, stills)
     * onto provider season maps — a no-op while nothing is fetched.
     * Reads a signal, so callers can use it inside a `computed`.
     */
    overlay(
        seasons: Record<string, XtreamSerieEpisode[]>,
        tmdbId: number | null | undefined
    ): Record<string, XtreamSerieEpisode[]> {
        const fetched = this.seasonsByKey();
        if (!tmdbId || fetched.size === 0) {
            return seasons;
        }

        const merged: Record<string, XtreamSerieEpisode[]> = {};
        for (const [seasonKey, episodes] of Object.entries(seasons)) {
            const forSeason = fetched.get(`${tmdbId}|${seasonKey}`)?.episodes;
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
     * disabled, or when the entry already holds the resolved season.
     * `context` carries the raw provider title and total season count so a
     * per-season slice ("The Mandalorian (2 season)" with its single season
     * renumbered to 1) fetches the season the title names instead of the
     * provider's number. A later call resolving a DIFFERENT season for the
     * same key (another slice of the show, or corrected navigation context)
     * refetches and overwrites the entry.
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

        const providerSeasonNumber = Number(episodes?.[0]?.season ?? seasonKey);
        if (!Number.isFinite(providerSeasonNumber)) {
            return;
        }

        const seasonNumber = resolveEnrichmentSeasonNumber({
            rawTitle: context?.rawTitle,
            providerSeasonNumber,
            providerSeasonCount: context?.seasonCount ?? 0,
        });

        const mapKey = `${tmdbId}|${seasonKey}`;
        const cached = this.seasonsByKey().get(mapKey);
        if (
            cached?.seasonNumber === seasonNumber ||
            this.pending.get(mapKey) === seasonNumber
        ) {
            return;
        }

        this.pending.set(mapKey, seasonNumber);

        // A mismatched entry belongs to another slice/context of this
        // show — drop it BEFORE fetching so a failed replacement fetch
        // can never leave the wrong season's metadata on screen (the
        // overlay then falls back to provider data until a retry).
        if (cached) {
            this.deleteEntry(mapKey);
        }
        try {
            const season = await this.tmdbEnrichment.getSeason(
                tmdbId,
                seasonNumber
            );

            // A newer resolution for this key superseded us mid-flight —
            // only the latest requested fetch may store its result.
            if (this.pending.get(mapKey) !== seasonNumber) {
                return;
            }
            if (!season) {
                // Transient failure — stays uncached so a later trigger
                // can retry.
                return;
            }

            const overviews = new Map(this.overviewsByKey());
            if (season.overview) {
                overviews.set(mapKey, season.overview);
            } else {
                overviews.delete(mapKey);
            }
            this.overviewsByKey.set(overviews);

            const next = new Map(this.seasonsByKey());
            next.set(mapKey, {
                seasonNumber,
                episodes: season.episodes ?? [],
            });
            this.seasonsByKey.set(next);
        } finally {
            if (this.pending.get(mapKey) === seasonNumber) {
                this.pending.delete(mapKey);
            }
        }
    }

    private deleteEntry(mapKey: string): void {
        const next = new Map(this.seasonsByKey());
        next.delete(mapKey);
        this.seasonsByKey.set(next);

        const overviews = new Map(this.overviewsByKey());
        overviews.delete(mapKey);
        this.overviewsByKey.set(overviews);
    }
}
