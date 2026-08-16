import { Injectable, inject } from '@angular/core';
import { TmdbMediaType } from '@iptvnator/shared/interfaces';
import { TmdbApiService } from './tmdb-api.service';
import { DiscoverTitle, mapDiscoverResults } from './tmdb-discover';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbDiscoverFilters } from './tmdb.types';

/**
 * Popularity caps how deep a facet page digs: fetching every 1990 movie
 * TMDB knows is neither possible nor useful, so the Discover page shows
 * the most popular slice and lets catalog matching do the rest.
 */
const MAX_DISCOVER_PAGES = 5;
/** FIFO bound for the session cache — a browse session revisits few keys */
const MAX_CACHE_ENTRIES = 30;

/**
 * `/discover` facade for the portal Discover pages. Deliberately session-
 * scoped: results are popularity-ranked and volatile, so they are cached
 * in memory only and never reach the persisted `tmdb_metadata` table.
 * Any failure returns `null` (not cached) — pages show their empty state
 * and a retry is a fresh request.
 */
@Injectable({ providedIn: 'root' })
export class TmdbDiscoverService {
    private readonly runtime = inject(TmdbRuntimeService);
    private readonly api = inject(TmdbApiService);

    private readonly cache = new Map<string, DiscoverTitle[]>();

    async discoverTitles(
        mediaType: TmdbMediaType,
        filters: TmdbDiscoverFilters
    ): Promise<DiscoverTitle[] | null> {
        if (!this.runtime.isEnabled()) {
            return null;
        }

        const language = this.runtime.language();
        const key = [
            mediaType,
            filters.year ?? '',
            filters.genreId ?? '',
            filters.countryCode ?? '',
            language,
        ].join('|');
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }

        try {
            const apiKey = this.runtime.apiKey();
            const first = await this.api.discoverTitles(
                mediaType,
                filters,
                1,
                language,
                apiKey
            );
            const pages = Math.min(
                Math.max(first.total_pages ?? 1, 1),
                MAX_DISCOVER_PAGES
            );
            const rest =
                pages > 1
                    ? await Promise.all(
                          Array.from({ length: pages - 1 }, (_, index) =>
                              this.api.discoverTitles(
                                  mediaType,
                                  filters,
                                  index + 2,
                                  language,
                                  apiKey
                              )
                          )
                      )
                    : [];

            // No .flatMap — the web dev-serve target compiles against a
            // pre-es2019 lib and rejects it (production builds accept it)
            const results = [];
            for (const response of [first, ...rest]) {
                results.push(...(response.results ?? []));
            }
            const titles = mapDiscoverResults(results, mediaType);

            if (this.cache.size >= MAX_CACHE_ENTRIES) {
                const oldestKey = this.cache.keys().next().value;
                if (oldestKey !== undefined) {
                    this.cache.delete(oldestKey);
                }
            }
            this.cache.set(key, titles);
            return titles;
        } catch (error) {
            console.warn('TMDB discover failed:', error);
            return null;
        }
    }
}
