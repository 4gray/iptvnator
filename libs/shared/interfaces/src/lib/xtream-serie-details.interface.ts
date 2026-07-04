import {
    TmdbEnrichedCastMember,
    TmdbRecommendation,
} from './tmdb.interface';

export interface XtreamSerieDetails {
    seasons: XtreamSerieSeason[];
    info: XtreamSerieInfo;
    episodes: Record<string, XtreamSerieEpisode[]>;
}

export interface XtreamSerieInfo {
    name: string;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    releaseDate: string;
    last_modified: string;
    rating: string;
    rating_5based: number;
    backdrop_path: string[];
    youtube_trailer: string;
    episode_run_time: string;
    category_id: string;
    /** Populated by TMDB enrichment; absent in raw provider responses */
    tmdb_cast?: TmdbEnrichedCastMember[];
    /** Populated by TMDB enrichment; matched against the catalog in views */
    tmdb_recommendations?: TmdbRecommendation[];
    /** Matched TMDB show id — enables lazy season/episode enrichment */
    tmdb_id?: number;
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
