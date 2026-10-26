import { TmdbApiClient } from './tmdb-api-client';
import { TmdbClientCache, TmdbClientRuntime } from './tmdb-client-contracts';
import { TMDB_DETAILS_CACHE_TTL_MS } from './tmdb-config';
import {
    fillSeasonFromFallback,
    seasonNeedsTextFallback,
} from './tmdb-language-fallback';
import { buildDetailsLookupKey } from './tmdb-matcher';
import { TmdbDetails, TmdbSeasonDetails } from './tmdb.types';

/** Lazy, language-scoped season metadata; failures never discard provider episodes. */
export class TmdbSeasonClient {
    constructor(
        private readonly runtime: TmdbClientRuntime,
        private readonly api: TmdbApiClient,
        private readonly cache: TmdbClientCache,
        private readonly report: (message: string) => void = () => undefined
    ) {}

    async getSeason(
        tmdbId: number,
        seasonNumber: number
    ): Promise<TmdbSeasonDetails | null> {
        if (!this.runtime.isEnabled()) return null;
        const season = await this.fetchSeason(
            tmdbId,
            seasonNumber,
            this.runtime.language()
        );
        if (!season || !seasonNeedsTextFallback(season)) return season;
        try {
            const cached = await this.cache.get(
                'tv',
                buildDetailsLookupKey(tmdbId),
                this.runtime.language()
            );
            const details = cached?.payload
                ? (JSON.parse(cached.payload) as TmdbDetails)
                : null;
            const language = details?.original_language?.trim();
            if (
                !language ||
                this.runtime
                    .language()
                    .toLowerCase()
                    .startsWith(language.toLowerCase())
            )
                return season;
            return fillSeasonFromFallback(
                season,
                await this.fetchSeason(tmdbId, seasonNumber, language)
            );
        } catch {
            return season;
        }
    }

    private async fetchSeason(
        tmdbId: number,
        seasonNumber: number,
        language: string
    ): Promise<TmdbSeasonDetails | null> {
        try {
            const lookupKey = `id:${tmdbId}|season:${seasonNumber}`;
            const cached = await this.cache.get('tv', lookupKey, language);
            if (
                this.cache.isFresh(cached, TMDB_DETAILS_CACHE_TTL_MS) &&
                cached?.payload
            ) {
                try {
                    return JSON.parse(cached.payload) as TmdbSeasonDetails;
                } catch {
                    /* Refetch corrupt rows. */
                }
            }
            const season = await this.api.getSeasonDetails(
                tmdbId,
                seasonNumber,
                language,
                this.runtime.apiKey()
            );
            await this.cache.set({
                mediaType: 'tv',
                lookupKey,
                language,
                tmdbId,
                payload: JSON.stringify(season),
            });
            return season;
        } catch {
            this.report('TMDB season enrichment failed.');
            return null;
        }
    }
}
