/**
 * Stalker portal series/serial details response structure.
 * Contains series metadata from Stalker/Ministra portals.
 */
export interface StalkerSerialDetails {
    /** Series title */
    name: string;
    /** Plot description */
    description: string;
    /** Director name */
    director: string;
    /** Comma-separated list of actors */
    actors: string;
    /** Release year */
    year: string;
    /** Comma-separated genres */
    genres_str: string;
    /** Age rating */
    age: string;
    /** IMDB rating as string */
    rating_imdb: string;
    /** Kinopoisk rating as string */
    rating_kinopoisk: string;
    /** Screenshot/poster URL */
    screenshot_uri: string;
    /** Date added to portal */
    added: string;
}
