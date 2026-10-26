import { Injectable, inject } from '@angular/core';
import { TmdbSeasonClient } from '@iptvnator/shared/tmdb';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';

/** Angular facade for the shared lazy, cached season metadata client. */
@Injectable({ providedIn: 'root' })
export class TmdbSeasonService {
    private readonly client = new TmdbSeasonClient(
        inject(TmdbRuntimeService),
        inject(TmdbApiService),
        inject(TmdbCacheService),
        (message) => console.warn(message)
    );
    async getSeasonEpisodes(tmdbId: number, seasonNumber: number) {
        const season = await this.getSeason(tmdbId, seasonNumber);
        return season ? (season.episodes ?? []) : null;
    }
    getSeason(tmdbId: number, seasonNumber: number) {
        return this.client.getSeason(tmdbId, seasonNumber);
    }
}
