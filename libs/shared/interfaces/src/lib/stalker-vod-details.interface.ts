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
    /** Movie title */
    name: string;
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
}
