import { Injectable, inject } from '@angular/core';
import { TmdbMediaType } from '@iptvnator/shared/interfaces';
import { TmdbApiService, isTmdbNotFound } from './tmdb-api.service';
import { trimDetailsForCache } from './tmdb-cache-payload';
import { TmdbCacheService } from './tmdb-cache.service';
import { TMDB_DETAILS_CACHE_TTL_MS } from './tmdb-config';
import {
    assessProviderId,
    buildDetailsLookupKey,
    parseProviderTmdbId,
} from './tmdb-matcher';
import { TmdbIdResolverService } from './tmdb-id-resolver.service';
import {
    detailsFallbackLanguage,
    fillDetailsFromFallback,
} from './tmdb-language-fallback';
import { DiscoverTitle } from './tmdb-discover';
import { TmdbDiscoverService } from './tmdb-discover.service';
import { TmdbPersonService } from './tmdb-person.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbSeasonService } from './tmdb-season.service';
import { TmdbTrendingService } from './tmdb-trending.service';
import {
    TmdbDetails,
    TmdbDiscoverFilters,
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
    private readonly discover = inject(TmdbDiscoverService);
    private readonly idResolver = inject(TmdbIdResolverService);

    isEnabled(): boolean {
        return this.runtime.isEnabled();
    }

    /**
     * Effective TMDB language ("en-US"). Exposed so consumers that cache
     * derived results (e.g. the dashboard recommendations rail) can key
     * them by the language the payloads were localized in.
     */
    language(): string {
        return this.runtime.language();
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

    /** Popular titles for one facet set (year/genre/country), session-cached */
    async discoverTitles(
        mediaType: TmdbMediaType,
        filters: TmdbDiscoverFilters
    ): Promise<DiscoverTitle[] | null> {
        return this.discover.discoverTitles(mediaType, filters);
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
     * defer to the (confidence-gated) search — but only on evidence the id
     * is wrong, and only when the search actually produces something, so a
     * localized or stylized title never costs the user their metadata.
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
            // Only a 404 proves the id is dead. Auth, rate-limit, 5xx and
            // offline failures are transient — remembering those would
            // disable a perfectly good id until the marker expires.
            if (isTmdbNotFound(error)) {
                console.warn(
                    `TMDB ${mediaType} provider id ${providerId} does not exist, falling back to search:`,
                    error
                );
                await this.idResolver.rememberBadProviderId(
                    mediaType,
                    providerId
                );
                return null;
            }

            // Rethrow instead: `enrich` reads a null here as "try the
            // search", and searching during an outage or a rate limit just
            // adds a request that will fail too — or, worse, succeeds and
            // swaps a strong id for a title match. The id stays good for
            // the next attempt.
            throw error;
        }

        if (!details || assessProviderId(details, query, mediaType) !== 'contradicted') {
            return details;
        }

        // The id resolves to a title whose release year contradicts the
        // provider's — the stale-id signature. Let the search try to beat
        // it; keep these details if it cannot.
        //
        // Deliberately NOT remembered: the id exists and may be correct for
        // a DIFFERENT item. The bad-id cache is keyed by id alone and shared
        // across playlists, so recording a per-item mismatch there would
        // deny the direct lookup to every other item that legitimately uses
        // the same id. The search verdict is cached anyway, so the repeat
        // cost is one details fetch.
        //
        // The search is best-effort here: offline, rate-limited or 5xx must
        // fall back to the details we already have, not discard them. Its
        // own gate needs a year, which this branch guarantees we have, so a
        // result that comes back is corroborated rather than merely named
        // alike.
        const searchedId = await this.idResolver
            .resolveBySearch(mediaType, query)
            .catch(() => null);
        if (searchedId === null || searchedId === providerId) {
            return details;
        }

        const searched = await this.getDetails(mediaType, searchedId).catch(
            () => null
        );
        return searched ?? details;
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
            payload: JSON.stringify(
                details === null ? null : trimDetailsForCache(details)
            ),
        });

        return details;
    }
}
