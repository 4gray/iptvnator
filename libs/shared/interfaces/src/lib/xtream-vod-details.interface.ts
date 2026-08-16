import {
    TmdbCountryFacet,
    TmdbEnrichedCastMember,
    TmdbGenreFacet,
    TmdbRecommendation,
} from './tmdb.interface';

export interface XtreamVodInfo {
    kinopoisk_url: string;
    tmdb_id: number | string;
    name: string;
    o_name: string;
    cover_big: string;
    movie_image: string;
    releasedate: string;
    /**
     * Set by TMDB enrichment when it filled `releasedate` itself because the
     * provider sent none. Absent in raw provider responses, and absent after
     * a merge that kept the provider's own date.
     *
     * The merge substitutes silently, so afterwards the field alone cannot
     * say who stated the date. Anything recording it as a PROVIDER fact —
     * `content.release_year`, and the exclusion index's `trustedReleaseYear`
     * — must read this first, or an inferred year ends up gating decisions
     * that are only sound on a stated one.
     */
    tmdb_supplied_release_date?: boolean;
    episode_run_time: number;
    youtube_trailer: string;
    director: string;
    actors: string;
    cast: string;
    description: string;
    plot: string;
    age: string;
    mpaa_rating: string;
    rating_count_kinopoisk: number;
    country: string;
    genre: string;
    backdrop_path: string[];
    duration_secs: number;
    duration: string;
    video: string[];
    audio: string[];
    bitrate: number;
    rating: number | string;
    runtime?: string;
    status?: string;
    rating_kinopoisk?: string;
    rating_imdb?: string;
    /** Populated by TMDB enrichment; absent in raw provider responses */
    tmdb_cast?: TmdbEnrichedCastMember[];
    /** Directors (movies) / creators (series) as clickable person chips */
    tmdb_directors?: TmdbEnrichedCastMember[];
    /** Populated by TMDB enrichment; matched against the catalog in views */
    tmdb_recommendations?: TmdbRecommendation[];
    /** Populated by TMDB enrichment; per-entry clickable Discover chips */
    tmdb_genres?: TmdbGenreFacet[];
    tmdb_countries?: TmdbCountryFacet[];
}

export interface XtreamVodMovieData {
    stream_id: number;
    name: string;
    added: string;
    category_id: string;
    container_extension: string;
    custom_sid: string | null;
    direct_source: string;
    category_ids?: number[];
}

export interface XtreamVodDetails {
    info?: XtreamVodInfo | [] | null;
    movie_data?: XtreamVodMovieData;
}

export function getXtreamVodInfo(
    details: Pick<XtreamVodDetails, 'info'> | null | undefined
): XtreamVodInfo | null {
    const info = details?.info;
    if (!info || Array.isArray(info) || typeof info !== 'object') {
        return null;
    }
    return info;
}

export function hasXtreamVodInfo(
    details: Pick<XtreamVodDetails, 'info'> | null | undefined
): details is XtreamVodDetails & { info: XtreamVodInfo } {
    return getXtreamVodInfo(details) !== null;
}
