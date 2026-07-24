import {
    TmdbEnrichedCastMember,
    TmdbRecommendation,
} from './tmdb.interface';

/**
 * Stalker portal VOD details response structure.
 * Contains movie metadata from Stalker/Ministra portals.
 */
export interface StalkerVodDetails {
    /** Unique identifier for the VOD item */
    id: string;
    /** Command string used to play the stream (e.g., "/media/file_123.mpg") */
    cmd: string;
    /** VOD metadata */
    info: StalkerVodInfo;
}

export interface StalkerVodInfo {
    /** Poster/cover image URL */
    movie_image: string;
    /** Plot description */
    description: string;
    /** Formatted/system title (often generic like "video_name_format") */
    name: string;
    /** Original title (preferred, more descriptive) */
    o_name?: string;
    /** Comma-separated list of actors */
    actors: string;
    /** Director name */
    director: string;
    /** Release date (format varies) */
    releasedate: string;
    /** Genre(s) */
    genre: string;
    /** IMDB rating as string */
    rating_imdb: string;
    /** Kinopoisk rating as string */
    rating_kinopoisk: string;
    /** Populated by TMDB enrichment; absent in raw portal responses */
    tmdb_cast?: TmdbEnrichedCastMember[];
    /** Directors (movies) / creators (series) as clickable person chips */
    tmdb_directors?: TmdbEnrichedCastMember[];
    /** TMDB backdrop URL — Stalker portals never provide one themselves */
    tmdb_backdrop?: string;
    /** YouTube trailer key from TMDB — Stalker portals provide no trailers */
    tmdb_trailer?: string;
    /** Populated by TMDB enrichment */
    tmdb_recommendations?: TmdbRecommendation[];
    /** Matched TMDB id — enables lazy season/episode enrichment */
    tmdb_id?: number;
}
