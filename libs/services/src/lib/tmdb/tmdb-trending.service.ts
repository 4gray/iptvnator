import { Injectable, inject } from '@angular/core';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import {
    TMDB_TRENDING_CACHE_TTL_MS,
    tmdbPosterUrl,
} from './tmdb-config';
import { extractYear } from './tmdb-matcher';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbSearchResult, TmdbTrendingEntry } from './tmdb.types';

/**
 * Weekly TMDB trending for the dashboard rail. Movie and TV lists are
 * fetched separately (one request each, cached for a day per language)
 * and merged by popularity.
 */
@Injectable({ providedIn: 'root' })
export class TmdbTrendingService {
    private readonly runtime = inject(TmdbRuntimeService);
    private readonly api = inject(TmdbApiService);
    private readonly cache = inject(TmdbCacheService);

    async getTrendingWeek(limit = 18): Promise<TmdbTrendingEntry[]> {
        if (!this.runtime.isEnabled()) {
            return [];
        }

        const [movies, tv] = await Promise.all([
            this.getTrendingFor('movie'),
            this.getTrendingFor('tv'),
        ]);

        return [...movies, ...tv]
            .sort((a, b) => b.popularity - a.popularity)
            .slice(0, limit);
    }

    private async getTrendingFor(
        mediaType: 'movie' | 'tv'
    ): Promise<TmdbTrendingEntry[]> {
        try {
            const language = this.runtime.language();
            const lookupKey = 'trending:week';

            const cached = await this.cache.get(
                mediaType,
                lookupKey,
                language
            );
            if (
                this.cache.isFresh(cached, TMDB_TRENDING_CACHE_TTL_MS) &&
                cached?.payload
            ) {
                try {
                    return this.toEntries(
                        JSON.parse(cached.payload) as TmdbSearchResult[],
                        mediaType
                    );
                } catch {
                    // Corrupt cache row — fall through to a fresh fetch
                }
            }

            const results = await this.api.getTrending(
                mediaType,
                language,
                this.runtime.apiKey()
            );

            await this.cache.set({
                mediaType,
                lookupKey,
                language,
                tmdbId: null,
                payload: JSON.stringify(results),
            });

            return this.toEntries(results, mediaType);
        } catch (error) {
            console.warn(`TMDB trending (${mediaType}) failed:`, error);
            return [];
        }
    }

    private toEntries(
        results: TmdbSearchResult[],
        mediaType: 'movie' | 'tv'
    ): TmdbTrendingEntry[] {
        return results
            .map((result) => {
                const title = result.title ?? result.name ?? '';
                const rating =
                    (result.vote_count ?? 0) > 0 && result.vote_average
                        ? result.vote_average.toFixed(1)
                        : null;
                return {
                    tmdbId: result.id,
                    mediaType,
                    title,
                    year: extractYear(
                        result.release_date ?? result.first_air_date
                    ),
                    posterUrl: tmdbPosterUrl(result.poster_path),
                    rating,
                    popularity: result.popularity ?? 0,
                };
            })
            .filter((entry) => entry.tmdbId > 0 && entry.title !== '');
    }
}
