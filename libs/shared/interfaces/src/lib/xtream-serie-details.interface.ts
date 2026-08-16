import {
    TmdbCountryFacet,
    TmdbEnrichedCastMember,
    TmdbGenreFacet,
    TmdbRecommendation,
    TmdbSeriesStatus,
} from './tmdb.interface';

export interface XtreamSerieDetails {
    seasons: XtreamSerieSeason[];
    info: XtreamSerieInfo;
    episodes: Record<string, XtreamSerieEpisode[]>;
    /**
     * Populated by lazy TMDB season enrichment; absent in raw provider
     * responses. Keyed by the provider season key (the `episodes` record
     * key). Detail views use it as the season-description fallback when
     * the provider's `seasons[].overview` is empty or URL-only junk.
     */
    tmdb_season_overviews?: Record<string, string>;
}

export interface XtreamSerieInfo {
    name: string;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    releaseDate: string;
    /** See `XtreamVodInfo.tmdb_supplied_release_date` — same contract */
    tmdb_supplied_release_date?: boolean;
    last_modified: string;
    rating: string;
    rating_5based: number;
    backdrop_path: string[];
    youtube_trailer: string;
    episode_run_time: string;
    category_id: string;
    /** Populated by TMDB enrichment; absent in raw provider responses */
    tmdb_cast?: TmdbEnrichedCastMember[];
    /** Directors (movies) / creators (series) as clickable person chips */
    tmdb_directors?: TmdbEnrichedCastMember[];
    /** Series production status (token, never a raw TMDB string) */
    tmdb_status?: TmdbSeriesStatus;
    /** Populated by TMDB enrichment; matched against the catalog in views */
    tmdb_recommendations?: TmdbRecommendation[];
    /** Matched TMDB show id — enables lazy season/episode enrichment */
    tmdb_id?: number;
    /** Populated by TMDB enrichment; per-entry clickable Discover chips */
    tmdb_genres?: TmdbGenreFacet[];
    tmdb_countries?: TmdbCountryFacet[];
}

export interface XtreamSerieEpisode {
    id: string;
    episode_num: number;
    title: string;
    container_extension: string;
    info: XtreamSerieEpisodeInfo | []; // Can be empty array when no metadata available
    custom_sid: string;
    added: string;
    season: number;
    direct_source: string;
}

export interface XtreamSerieEpisodeInfo {
    tmdb_id?: number;
    releasedate?: string;
    plot?: string;
    duration_secs?: number;
    duration?: string;
    movie_image?: string;
    video?: Record<string, string>; // TODO
    audio?: Record<string, string>; // TODO
    bitrate?: number;
    rating?: number;
    season?: string;
}

export interface XtreamSerieSeason {
    air_date: string;
    episode_count: number;
    id: number;
    name: string;
    overview: string;
    season_number: number;
    cover: string;
    cover_big: string;
}
