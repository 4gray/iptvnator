import { Injectable, inject } from '@angular/core';
import { TmdbMediaType } from '@iptvnator/shared/interfaces';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import {
    TMDB_DETAILS_CACHE_TTL_MS,
    TMDB_MATCH_CACHE_TTL_MS,
    TMDB_NEGATIVE_MATCH_CACHE_TTL_MS,
    tmdbSearchLanguageForTitle,
} from './tmdb-config';
import {
    buildDetailsLookupKey,
    buildSearchLookupKey,
    buildSearchTitleVariants,
    extractYear,
    parseProviderTmdbId,
    pickConfidentMatch,
} from './tmdb-matcher';
import { TmdbPersonService } from './tmdb-person.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbSeasonService } from './tmdb-season.service';
import {
    TmdbDetails,
    TmdbEnrichmentQuery,
    TmdbEpisode,
    TmdbMovieDetails,
    TmdbPersonDetails,
    TmdbSeasonDetails,
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
            const tmdbId =
                parseProviderTmdbId(query.tmdbId) ??
                (await this.resolveIdBySearch(mediaType, query));

            if (tmdbId === null) {
                return null;
            }

            return await this.getDetails(mediaType, tmdbId);
        } catch (error) {
            console.warn(`TMDB ${mediaType} enrichment failed:`, error);
            return null;
        }
    }

    /**
     * Resolve a title/year to a TMDB id via /search with the confidence
     * gate. Both hits and misses are cached; misses use a shorter TTL.
     */
    private async resolveIdBySearch(
        mediaType: TmdbMediaType,
        query: TmdbEnrichmentQuery
    ): Promise<number | null> {
        // Try the original title, the display title, then language-prefix-
        // stripped fallbacks; the first confident match wins.
        const variants = buildSearchTitleVariants(
            query.title,
            query.originalTitle
        );
        if (variants.length === 0) {
            return null;
        }

        const year = query.year ?? extractYear(null, query.title);
        const cacheLanguage = tmdbSearchLanguageForTitle(
            variants[0],
            this.runtime.appLanguage()
        );
        const lookupKey = buildSearchLookupKey(variants[0], year);

        const cached = await this.cache.get(
            mediaType,
            lookupKey,
            cacheLanguage
        );
        const ttl =
            cached?.tmdbId !== null && cached?.tmdbId !== undefined
                ? TMDB_MATCH_CACHE_TTL_MS
                : TMDB_NEGATIVE_MATCH_CACHE_TTL_MS;
        if (this.cache.isFresh(cached, ttl)) {
            return cached?.tmdbId ?? null;
        }

        let match = null;
        for (const variant of variants) {
            // Cyrillic (and other non-app-script) titles search in their
            // own language so TMDB returns comparable titles — see
            // tmdbSearchLanguageForTitle. Search by title only: TMDB's
            // year params filter strictly; the ±1/season tolerance lives
            // in pickConfidentMatch instead.
            const language = tmdbSearchLanguageForTitle(
                variant,
                this.runtime.appLanguage()
            );
            const results =
                mediaType === 'movie'
                    ? await this.api.searchMovie(
                          variant,
                          null,
                          language,
                          this.runtime.apiKey()
                      )
                    : await this.api.searchTv(
                          variant,
                          null,
                          language,
                          this.runtime.apiKey()
                      );

            match = pickConfidentMatch(
                results,
                { title: variant, year },
                mediaType
            );
            if (match) {
                break;
            }
        }

        await this.cache.set({
            mediaType,
            lookupKey,
            language: cacheLanguage,
            tmdbId: match?.id ?? null,
            payload: null,
        });

        return match?.id ?? null;
    }

    private async getDetails(
        mediaType: TmdbMediaType,
        tmdbId: number
    ): Promise<TmdbDetails | null> {
        const language = this.runtime.language();
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
