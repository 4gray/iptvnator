import { Injectable, inject } from '@angular/core';
import { TmdbMediaType } from '@iptvnator/shared/interfaces';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import {
    TMDB_MATCH_CACHE_TTL_MS,
    TMDB_NEGATIVE_MATCH_CACHE_TTL_MS,
    tmdbSearchLanguageForTitle,
} from './tmdb-config';
import {
    SearchTitleVariant,
    buildBadProviderIdLookupKey,
    buildSearchLookupKey,
    buildSearchTitleVariants,
    extractYear,
    pickConfidentMatch,
} from './tmdb-matcher';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbEnrichmentQuery } from './tmdb.types';

/**
 * "This id is wrong" verdicts are about the provider's data, not about a
 * translation, so they are cached under one language-independent row.
 */
const BAD_ID_CACHE_LANGUAGE = 'any';

/**
 * Resolves a provider item to a TMDB id: the confidence-gated title search
 * plus the negative cache for provider-supplied ids we have proven wrong.
 * Extracted from the enrichment orchestrator so both concerns stay
 * testable and the facade keeps its size in check.
 */
@Injectable({ providedIn: 'root' })
export class TmdbIdResolverService {
    private readonly runtime = inject(TmdbRuntimeService);
    private readonly api = inject(TmdbApiService);
    private readonly cache = inject(TmdbCacheService);

    /**
     * Resolve a title/year to a TMDB id via /search with the confidence
     * gate. Every attempted variant is cached under its own key — hits for
     * 30 days, misses for 7 — because a verdict belongs to the search that
     * produced it, not to the item that asked: two items sharing an
     * original title but not a display title walk different variant lists,
     * and a row keyed on the first variant alone would hand the second item
     * the first one's answer, or its cached miss.
     */
    async resolveBySearch(
        mediaType: TmdbMediaType,
        query: TmdbEnrichmentQuery
    ): Promise<number | null> {
        // Try the original title, the display title, then language-prefix-
        // stripped fallbacks; the first confident match wins.
        const variants = buildSearchTitleVariants(
            query.title,
            query.originalTitle
        );
        const year = query.year ?? extractYear(null, query.title);

        for (const variant of variants) {
            const resolved = await this.resolveVariant(
                mediaType,
                variant,
                year
            );
            if (resolved !== null) {
                return resolved;
            }
        }

        return null;
    }

    /** One variant's cached or freshly searched verdict; null on a miss. */
    private async resolveVariant(
        mediaType: TmdbMediaType,
        variant: SearchTitleVariant,
        year: number | null
    ): Promise<number | null> {
        // Cyrillic (and other non-app-script) titles search in their own
        // language so TMDB returns comparable titles — see
        // tmdbSearchLanguageForTitle. The cache row carries the same
        // language, since the answer depends on it.
        const language = tmdbSearchLanguageForTitle(
            variant.normalized,
            this.runtime.appLanguage()
        );
        const lookupKey = buildSearchLookupKey(variant.query, year);

        const cached = await this.cache.get(mediaType, lookupKey, language);
        const ttl =
            cached?.tmdbId !== null && cached?.tmdbId !== undefined
                ? TMDB_MATCH_CACHE_TTL_MS
                : TMDB_NEGATIVE_MATCH_CACHE_TTL_MS;
        if (this.cache.isFresh(cached, ttl)) {
            return cached?.tmdbId ?? null;
        }

        // Search by title only: TMDB's year params filter strictly; the
        // ±1/season tolerance lives in pickConfidentMatch instead. The wire
        // query is the provider's own spelling (`variant.query`), never the
        // folded comparison key: TMDB does not fold Cyrillic "й" the way
        // the key does, and a folded query finds nothing.
        const results =
            mediaType === 'movie'
                ? await this.api.searchMovie(
                      variant.query,
                      null,
                      language,
                      this.runtime.apiKey()
                  )
                : await this.api.searchTv(
                      variant.query,
                      null,
                      language,
                      this.runtime.apiKey()
                  );

        const match = pickConfidentMatch(
            results,
            { title: variant.normalized, year },
            mediaType
        );

        await this.cache.set({
            mediaType,
            lookupKey,
            language,
            tmdbId: match?.id ?? null,
            payload: null,
        });

        return match?.id ?? null;
    }

    /**
     * True when this id is known NOT TO EXIST on TMDB. Without this a dead
     * id costs one wasted 404 on every single detail open, forever —
     * failed detail fetches cache nothing.
     *
     * The verdict is deliberately about the ID, not about the item that
     * supplied it: the row is keyed by id alone and shared across
     * playlists, so only "TMDB returned 404 for this id" may be recorded
     * here. A per-item mismatch is never cached — see
     * `TmdbEnrichmentService.detailsForProviderId`.
     */
    async isKnownBadProviderId(
        mediaType: TmdbMediaType,
        tmdbId: number
    ): Promise<boolean> {
        const cached = await this.cache.get(
            mediaType,
            buildBadProviderIdLookupKey(tmdbId),
            BAD_ID_CACHE_LANGUAGE
        );
        return this.cache.isFresh(cached, TMDB_NEGATIVE_MATCH_CACHE_TTL_MS);
    }

    async rememberBadProviderId(
        mediaType: TmdbMediaType,
        tmdbId: number
    ): Promise<void> {
        await this.cache.set({
            mediaType,
            lookupKey: buildBadProviderIdLookupKey(tmdbId),
            language: BAD_ID_CACHE_LANGUAGE,
            tmdbId: null,
            payload: null,
        });
    }
}
