import { Injectable } from '@angular/core';
import { TMDB_API_BASE_URL } from './tmdb-config';
import {
    TmdbDiscoverFilters,
    TmdbDiscoverResponse,
    TmdbMovieDetails,
    TmdbPersonDetails,
    TmdbSearchResponse,
    TmdbSearchResult,
    TmdbSeasonDetails,
    TmdbTvDetails,
} from './tmdb.types';

/**
 * Thin TMDB v3 API client. Uses `fetch` directly — TMDB supports CORS, so
 * both the Electron renderer and the PWA can call it without a proxy.
 * Supports classic v3 keys (query param) and v4 read tokens (Bearer).
 */
/**
 * A non-2xx TMDB response. Carries the status so callers can tell a
 * definitive verdict (404 — this id does not exist) apart from a
 * transient one (401/429/5xx, offline), which must stay retryable.
 */
export class TmdbApiError extends Error {
    constructor(
        readonly status: number,
        statusText = ''
    ) {
        super(`TMDB request failed: ${status} ${statusText}`.trim());
        this.name = 'TmdbApiError';
    }
}

export function isTmdbNotFound(error: unknown): boolean {
    return error instanceof TmdbApiError && error.status === 404;
}

@Injectable({ providedIn: 'root' })
export class TmdbApiService {
    async searchMovie(
        query: string,
        year: number | null,
        language: string,
        apiKey: string
    ): Promise<TmdbSearchResult[]> {
        const response = await this.request<TmdbSearchResponse>(
            '/search/movie',
            {
                query,
                language,
                ...(year !== null ? { year: String(year) } : {}),
            },
            apiKey
        );
        return response.results ?? [];
    }

    async searchTv(
        query: string,
        year: number | null,
        language: string,
        apiKey: string
    ): Promise<TmdbSearchResult[]> {
        const response = await this.request<TmdbSearchResponse>(
            '/search/tv',
            {
                query,
                language,
                ...(year !== null ? { first_air_date_year: String(year) } : {}),
            },
            apiKey
        );
        return response.results ?? [];
    }

    async getMovieDetails(
        tmdbId: number,
        language: string,
        apiKey: string
    ): Promise<TmdbMovieDetails> {
        return this.request<TmdbMovieDetails>(
            `/movie/${tmdbId}`,
            { language, append_to_response: 'credits,videos,recommendations' },
            apiKey
        );
    }

    async getTvDetails(
        tmdbId: number,
        language: string,
        apiKey: string
    ): Promise<TmdbTvDetails> {
        return this.request<TmdbTvDetails>(
            `/tv/${tmdbId}`,
            {
                language,
                // aggregate_credits spans the whole run; plain `credits` on
                // a TV id is documented as the LATEST SEASON only, so both
                // are needed to reconstruct the real cast (see tmdb-merge)
                append_to_response:
                    'credits,aggregate_credits,videos,recommendations',
            },
            apiKey
        );
    }

    /** Weekly trending titles for one media type */
    async getTrending(
        mediaType: 'movie' | 'tv',
        language: string,
        apiKey: string
    ): Promise<TmdbSearchResult[]> {
        const response = await this.request<TmdbSearchResponse>(
            `/trending/${mediaType}/week`,
            { language },
            apiKey
        );
        return response.results ?? [];
    }

    /**
     * One `/discover` page for the given facets, most popular first. The
     * year filter parameter differs per media type; genre ids are only
     * valid within their own media type's id space.
     */
    async discoverTitles(
        mediaType: 'movie' | 'tv',
        filters: TmdbDiscoverFilters,
        page: number,
        language: string,
        apiKey: string
    ): Promise<TmdbDiscoverResponse> {
        const yearParam =
            mediaType === 'movie'
                ? 'primary_release_year'
                : 'first_air_date_year';
        return this.request<TmdbDiscoverResponse>(
            `/discover/${mediaType}`,
            {
                language,
                sort_by: 'popularity.desc',
                page: String(page),
                ...(filters.year ? { [yearParam]: String(filters.year) } : {}),
                ...(filters.genreId
                    ? { with_genres: String(filters.genreId) }
                    : {}),
                ...(filters.countryCode
                    ? { with_origin_country: filters.countryCode }
                    : {}),
            },
            apiKey
        );
    }

    async getPersonDetails(
        personId: number,
        language: string,
        apiKey: string
    ): Promise<TmdbPersonDetails> {
        return this.request<TmdbPersonDetails>(
            `/person/${personId}`,
            { language, append_to_response: 'combined_credits' },
            apiKey
        );
    }

    async getSeasonDetails(
        tmdbId: number,
        seasonNumber: number,
        language: string,
        apiKey: string
    ): Promise<TmdbSeasonDetails> {
        return this.request<TmdbSeasonDetails>(
            `/tv/${tmdbId}/season/${seasonNumber}`,
            { language },
            apiKey
        );
    }

    /**
     * Cheap authenticated call to verify an API key. Used by the settings
     * "check key" button.
     */
    async validateApiKey(apiKey: string): Promise<boolean> {
        try {
            await this.request('/configuration', {}, apiKey);
            return true;
        } catch {
            return false;
        }
    }

    private async request<T>(
        path: string,
        params: Record<string, string>,
        apiKey: string
    ): Promise<T> {
        const url = new URL(`${TMDB_API_BASE_URL}${path}`);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }

        // v4 read access tokens are JWTs sent as a Bearer header; v3 keys
        // travel as the api_key query param
        const isBearerToken = apiKey.startsWith('eyJ');
        if (!isBearerToken) {
            url.searchParams.set('api_key', apiKey);
        }

        const response = await fetch(url.toString(), {
            headers: {
                accept: 'application/json',
                ...(isBearerToken
                    ? { authorization: `Bearer ${apiKey}` }
                    : {}),
            },
        });

        if (!response.ok) {
            throw new TmdbApiError(response.status, response.statusText);
        }

        return (await response.json()) as T;
    }
}
