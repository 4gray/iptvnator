import { Injectable, inject } from '@angular/core';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TMDB_DETAILS_CACHE_TTL_MS } from './tmdb-config';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbEpisode, TmdbSeasonDetails } from './tmdb.types';

/**
 * Episode list of one season (names, overviews, stills, air dates) in the
 * app language. Fetched lazily when a season is opened and cached like
 * details payloads. Returns `null` when enrichment is off or the request
 * fails — episode lists then stay provider-only.
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
        if (!this.runtime.isEnabled()) {
            return null;
        }

        try {
            const language = this.runtime.language();
            const lookupKey = `id:${tmdbId}|season:${seasonNumber}`;

            const cached = await this.cache.get('tv', lookupKey, language);
            if (
                this.cache.isFresh(cached, TMDB_DETAILS_CACHE_TTL_MS) &&
                cached?.payload
            ) {
                try {
                    const season = JSON.parse(
                        cached.payload
                    ) as TmdbSeasonDetails;
                    return season.episodes ?? [];
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

            return season.episodes ?? [];
        } catch (error) {
            console.warn('TMDB season enrichment failed:', error);
            return null;
        }
    }
}
