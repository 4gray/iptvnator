import { Injectable, inject } from '@angular/core';
import { TmdbMetadataClient } from '@iptvnator/shared/tmdb';
import { TmdbMediaType } from '@iptvnator/shared/interfaces';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TmdbIdResolverService } from './tmdb-id-resolver.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbPersonService } from './tmdb-person.service';
import { TmdbSeasonService } from './tmdb-season.service';
import { TmdbTrendingService } from './tmdb-trending.service';
import { TmdbDiscoverService } from './tmdb-discover.service';
import { DiscoverTitle } from './tmdb-discover';
import {
    TmdbDiscoverFilters,
    TmdbEpisode,
    TmdbPersonDetails,
    TmdbSeasonDetails,
    TmdbTrendingEntry,
} from './tmdb.types';
@Injectable({ providedIn: 'root' })
export class TmdbEnrichmentService extends TmdbMetadataClient {
    private readonly person = inject(TmdbPersonService);
    private readonly season = inject(TmdbSeasonService);
    private readonly trending = inject(TmdbTrendingService);
    private readonly discover = inject(TmdbDiscoverService);
    constructor() {
        super(
            inject(TmdbRuntimeService),
            inject(TmdbApiService),
            inject(TmdbCacheService),
            inject(TmdbIdResolverService)
        );
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
}
