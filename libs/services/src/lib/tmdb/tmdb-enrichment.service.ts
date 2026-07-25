import { Injectable, inject } from '@angular/core';
import { TmdbMediaType } from '@iptvnator/shared/interfaces';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TMDB_DETAILS_CACHE_TTL_MS } from './tmdb-config';
import {
    buildDetailsLookupKey,
    detailsMatchProviderTitle,
    parseProviderTmdbId,
} from './tmdb-matcher';
import { TmdbIdResolverService } from './tmdb-id-resolver.service';
import {
    detailsFallbackLanguage,
    fillDetailsFromFallback,
} from './tmdb-language-fallback';
import { TmdbPersonService } from './tmdb-person.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbSeasonService } from './tmdb-season.service';
import { TmdbTrendingService } from './tmdb-trending.service';
import {
    TmdbDetails,
    TmdbEnrichmentQuery,
    TmdbEpisode,
    TmdbMovieDetails,
    TmdbPersonDetails,
    TmdbSeasonDetails,
    TmdbTrendingEntry,
    TmdbTvDetails,
} from './tmdb.types';

/**
 * Best-effort TMDB enrichment orchestrator. Resolves a provider item to a
 * TMDB id (trusting the provider's tmdb_id, else a confidence-gated title
 * search), fetches localized details with credits, and caches every step.
 * Any failure returns `null` — detail views always render provider data.
 *
 * Person and season lookups live in {@link TmdbPersonService} and
 * {@link TmdbSeasonService}; the delegating methods here keep the store
 * glue talking to a single facade.
 */
@Injectable({ providedIn: 'root' })
export class TmdbEnrichmentService {
    private readonly runtime = inject(TmdbRuntimeService);
    private readonly api = inject(TmdbApiService);
    private readonly cache = inject(TmdbCacheService);
    private readonly person = inject(TmdbPersonService);
    private readonly season = inject(TmdbSeasonService);
    private readonly trending = inject(TmdbTrendingService);
    private readonly idResolver = inject(TmdbIdResolverService);

    isEnabled(): boolean {
        return this.runtime.isEnabled();
    }

    async enrichMovie(
        query: TmdbEnrichmentQuery
    ): Promise<TmdbMovieDetails | null> {
        return (await this.enrich('movie', query)) as TmdbMovieDetails | null;
    }

    async enrichTv(query: TmdbEnrichmentQuery): Promise<TmdbTvDetails | null> {
        return (await this.enrich('tv', query)) as TmdbTvDetails | null;
    }

    async getSeasonEpisodes(
        tmdbId: number,
        seasonNumber: number
    ): Promise<TmdbEpisode[] | null> {
        return this.season.getSeasonEpisodes(tmdbId, seasonNumber);
    }

    /**
     * Full season payload (overview + episodes) in the app language, using
     * the same cache rows as `getSeasonEpisodes`. Returns `null` when
     * enrichment is off or the request fails.
     */
    async getSeason(
        tmdbId: number,
        seasonNumber: number
    ): Promise<TmdbSeasonDetails | null> {
        return this.season.getSeason(tmdbId, seasonNumber);
    }

    /** Weekly trending titles (movies + series merged by popularity) */
    async getTrendingWeek(limit?: number): Promise<TmdbTrendingEntry[]> {
        return this.trending.getTrendingWeek(limit);
    }

    async getPersonDetails(
        personId: number
    ): Promise<TmdbPersonDetails | null> {
        return this.person.getPersonDetails(personId);
    }

    private async enrich(
        mediaType: TmdbMediaType,
        query: TmdbEnrichmentQuery
    ): Promise<TmdbDetails | null> {
        if (!this.isEnabled()) {
            return null;
        }

        try {
            const providerId = parseProviderTmdbId(query.tmdbId);
            if (
                providerId !== null &&
                !(await this.idResolver.isKnownBadProviderId(
                    mediaType,
                    providerId
                ))
            ) {
                const details = await this.detailsForProviderId(
                    mediaType,
                    providerId,
                    query
                );
                if (details) {
                    return details;
                }
            }

            const searchedId = await this.idResolver.resolveBySearch(
                mediaType,
                query
            );
            return searchedId === null
                ? null
                : await this.getDetails(mediaType, searchedId);
        } catch (error) {
            console.warn(`TMDB ${mediaType} enrichment failed:`, error);
            return null;
        }
    }

    /**
     * Details for a provider-supplied `tmdb_id`, or `null` when the id is
     * unusable and the caller should fall back to the title search.
     *
     * Providers ship broken ids. A dead one used to short-circuit the
     * search and leave the item permanently unenriched; a stale-but-valid
     * one silently rendered another title's plot and cast. Both cases now
     * defer to the (confidence-gated) search — but only when the search
     * actually produces something, so a legitimately localized title that
     * merely fails the name check never costs the user their metadata.
     */
    private async detailsForProviderId(
        mediaType: TmdbMediaType,
        providerId: number,
        query: TmdbEnrichmentQuery
    ): Promise<TmdbDetails | null> {
        let details: TmdbDetails | null;
        try {
            details = await this.getDetails(mediaType, providerId);
        } catch (error) {
            console.warn(
                `TMDB ${mediaType} details for provider id ${providerId} failed, falling back to search:`,
                error
            );
            await this.idResolver.rememberBadProviderId(mediaType, providerId);
            return null;
        }

        if (!details || detailsMatchProviderTitle(details, query)) {
            return details;
        }

        // The id resolves, but to something that does not look like our
        // item. Let the search try to beat it; keep these details if it
        // cannot, since a title mismatch alone is not proof of a bad id.
        const searchedId = await this.idResolver.resolveBySearch(
            mediaType,
            query
        );
        if (searchedId === null || searchedId === providerId) {
            return details;
        }

        const searched = await this.getDetails(mediaType, searchedId).catch(
            () => null
        );
        if (!searched) {
            return details;
        }

        await this.idResolver.rememberBadProviderId(mediaType, providerId);
        return searched;
    }

    private async getDetails(
        mediaType: TmdbMediaType,
        tmdbId: number
    ): Promise<TmdbDetails | null> {
        const details = await this.fetchDetails(
            mediaType,
            tmdbId,
            this.runtime.language()
        );
        if (!details) {
            return details;
        }

        // TMDB language-filters both text and videos: a Russian-only title
        // has an empty overview AND no trailer in en-US. Retry once in the
        // content's original language and fill only the missing fields.
        const fallbackLanguage = detailsFallbackLanguage(
            details,
            this.runtime.language()
        );
        if (!fallbackLanguage) {
            return details;
        }
        // Best-effort: a failing fallback fetch must never cost the
        // already-fetched primary payload (cast, artwork, trailer, ...)
        try {
            const fallback = await this.fetchDetails(
                mediaType,
                tmdbId,
                fallbackLanguage
            );
            return fillDetailsFromFallback(details, fallback);
        } catch (error) {
            console.warn('TMDB fallback-language fetch failed:', error);
            return details;
        }
    }

    private async fetchDetails(
        mediaType: TmdbMediaType,
        tmdbId: number,
        language: string
    ): Promise<TmdbDetails | null> {
        const lookupKey = buildDetailsLookupKey(tmdbId);

        const cached = await this.cache.get(mediaType, lookupKey, language);
        if (
            this.cache.isFresh(cached, TMDB_DETAILS_CACHE_TTL_MS) &&
            cached?.payload
        ) {
            try {
                return JSON.parse(cached.payload) as TmdbDetails;
            } catch {
                // Corrupt cache row — fall through to a fresh fetch
            }
        }

        const details =
            mediaType === 'movie'
                ? await this.api.getMovieDetails(
                      tmdbId,
                      language,
                      this.runtime.apiKey()
                  )
                : await this.api.getTvDetails(
                      tmdbId,
                      language,
                      this.runtime.apiKey()
                  );

        await this.cache.set({
            mediaType,
            lookupKey,
            language,
            tmdbId,
            payload: JSON.stringify(details),
        });

        return details;
    }
}
