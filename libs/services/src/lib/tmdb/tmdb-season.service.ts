import { Injectable, inject } from '@angular/core';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TMDB_DETAILS_CACHE_TTL_MS } from './tmdb-config';
import {
    fillSeasonFromFallback,
    seasonNeedsTextFallback,
} from './tmdb-language-fallback';
import { buildDetailsLookupKey } from './tmdb-matcher';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbDetails, TmdbEpisode, TmdbSeasonDetails } from './tmdb.types';

/**
 * Season payloads (overview + episode list with names, overviews, stills,
 * air dates) in the app language. Fetched lazily when a season is opened
 * and cached like details payloads. Returns `null` when enrichment is off
 * or the request fails — season data then stays provider-only.
 */
@Injectable({ providedIn: 'root' })
export class TmdbSeasonService {
    private readonly runtime = inject(TmdbRuntimeService);
    private readonly api = inject(TmdbApiService);
    private readonly cache = inject(TmdbCacheService);

    async getSeasonEpisodes(
        tmdbId: number,
        seasonNumber: number
    ): Promise<TmdbEpisode[] | null> {
        const season = await this.getSeason(tmdbId, seasonNumber);
        return season ? (season.episodes ?? []) : null;
    }

    /** Full season payload (overview + episodes), same cache rows. */
    async getSeason(
        tmdbId: number,
        seasonNumber: number
    ): Promise<TmdbSeasonDetails | null> {
        if (!this.runtime.isEnabled()) {
            return null;
        }

        const season = await this.fetchSeason(
            tmdbId,
            seasonNumber,
            this.runtime.language()
        );
        if (!season || !seasonNeedsTextFallback(season)) {
            return season;
        }

        // No usable text in the app language — retry once in the show's
        // original language (read from the already-cached show details)
        // and fill the missing overviews/names.
        const fallbackLanguage = await this.originalShowLanguage(tmdbId);
        if (
            !fallbackLanguage ||
            this.runtime
                .language()
                .toLowerCase()
                .startsWith(fallbackLanguage.toLowerCase())
        ) {
            return season;
        }
        const fallback = await this.fetchSeason(
            tmdbId,
            seasonNumber,
            fallbackLanguage
        );
        return fillSeasonFromFallback(season, fallback);
    }

    /**
     * The show's original_language from the cached TV details row. Season
     * fetches always happen after a show-level match, so the row exists;
     * null when it doesn't (then no fallback is attempted).
     */
    private async originalShowLanguage(tmdbId: number): Promise<string | null> {
        try {
            const cached = await this.cache.get(
                'tv',
                buildDetailsLookupKey(tmdbId),
                this.runtime.language()
            );
            if (!cached?.payload) {
                return null;
            }
            const details = JSON.parse(cached.payload) as TmdbDetails;
            return details.original_language?.trim() || null;
        } catch {
            return null;
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
                    // Corrupt cache row — fall through to a fresh fetch
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
        } catch (error) {
            console.warn('TMDB season enrichment failed:', error);
            return null;
        }
    }
}
