import { Injectable, inject } from '@angular/core';
import type {
    IntroDbEpisodeSegments,
    IntroDbSegmentsRequest,
} from '@iptvnator/shared/interfaces';
import { TmdbApiService } from '../tmdb/tmdb-api.service';
import { TmdbRuntimeService } from '../tmdb/tmdb-runtime.service';
import { searchTvMazeImdbId } from './tvmaze-imdb-lookup';

/** One episode to look up; the series is named by TMDB id and/or title. */
export interface IntroDbEpisodeLookup {
    /** TMDB show id, when TMDB enrichment matched the series. */
    tmdbId: number | null;
    /** Provider series title; resolved through TVmaze without a TMDB id. */
    seriesTitle: string | null;
    seasonNumber: number;
    episodeNumber: number;
}

const IMDB_ID_PATTERN = /^tt\d{7,10}$/;

/**
 * Intro / recap / outro timestamps for the "Skip intro" button.
 *
 * IntroDB keys its data by the series' IMDb id, which no IPTV provider
 * supplies. It comes from TMDB's external ids when enrichment is enabled and
 * matched the show, else from a TVmaze title search. The segments themselves
 * come through the Electron main process (the API admits only its own web
 * origin), so in the PWA `isAvailable` is false and no button ever shows.
 *
 * Answers are memoized for the session, failures are not: a lookup that
 * failed while offline is asked again the next time the episode plays.
 */
@Injectable({ providedIn: 'root' })
export class IntroDbService {
    private readonly tmdbApi = inject(TmdbApiService);
    private readonly tmdbRuntime = inject(TmdbRuntimeService);
    private readonly imdbIds = new Map<string, Promise<string | null>>();
    private readonly segments = new Map<
        string,
        Promise<IntroDbEpisodeSegments | null>
    >();

    get isAvailable(): boolean {
        return (
            typeof window !== 'undefined' &&
            typeof window.electron?.getIntroDbSegments === 'function'
        );
    }

    async getEpisodeSegments(
        lookup: IntroDbEpisodeLookup
    ): Promise<IntroDbEpisodeSegments | null> {
        if (
            !this.isAvailable ||
            !Number.isInteger(lookup.seasonNumber) ||
            !Number.isInteger(lookup.episodeNumber) ||
            lookup.seasonNumber < 1 ||
            lookup.episodeNumber < 1
        ) {
            return null;
        }
        const imdbId = await this.resolveImdbId(lookup);
        if (!imdbId) {
            return null;
        }
        const request: IntroDbSegmentsRequest = {
            imdbId,
            seasonNumber: lookup.seasonNumber,
            episodeNumber: lookup.episodeNumber,
        };
        return this.memoize(
            this.segments,
            `${imdbId}|${request.seasonNumber}|${request.episodeNumber}`,
            () => this.requestSegments(request)
        );
    }

    private resolveImdbId(
        lookup: IntroDbEpisodeLookup
    ): Promise<string | null> {
        const title = lookup.seriesTitle?.trim() ?? '';
        const tmdbId =
            lookup.tmdbId && this.tmdbRuntime.isEnabled()
                ? lookup.tmdbId
                : null;
        if (!tmdbId && !title) {
            return Promise.resolve(null);
        }
        return this.memoize(
            this.imdbIds,
            tmdbId ? `tmdb:${tmdbId}` : `title:${title.toLowerCase()}`,
            async () =>
                (tmdbId ? await this.imdbIdFromTmdb(tmdbId) : null) ??
                (title ? await searchTvMazeImdbId(title) : null)
        );
    }

    private async imdbIdFromTmdb(tmdbId: number): Promise<string | null> {
        try {
            const ids = await this.tmdbApi.getTvExternalIds(
                tmdbId,
                this.tmdbRuntime.apiKey()
            );
            return typeof ids.imdb_id === 'string' &&
                IMDB_ID_PATTERN.test(ids.imdb_id)
                ? ids.imdb_id
                : null;
        } catch {
            return null;
        }
    }

    private async requestSegments(
        request: IntroDbSegmentsRequest
    ): Promise<IntroDbEpisodeSegments | null> {
        try {
            return (await window.electron?.getIntroDbSegments(request)) ?? null;
        } catch {
            return null;
        }
    }

    /** Shares one in-flight request per key and forgets null answers. */
    private memoize<T>(
        cache: Map<string, Promise<T | null>>,
        key: string,
        load: () => Promise<T | null>
    ): Promise<T | null> {
        const cached = cache.get(key);
        if (cached) {
            return cached;
        }
        const pending = load().then((value) => {
            if (value === null) {
                cache.delete(key);
            }
            return value;
        });
        cache.set(key, pending);
        return pending;
    }
}
