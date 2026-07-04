/**
 * One confident cross-playlist title match returned by the Electron DB
 * worker (`DB_MATCH_TITLES`). Used by the actor page's "All portals"
 * scope: matching runs over the trigram FTS index of the `content` table
 * (Xtream playlists only — Stalker content is never imported).
 */
export interface CatalogTitleMatch {
    /** The title from the request this row matched (verbatim) */
    queryTitle: string;
    playlistId: string;
    playlistName: string;
    /** Xtream category id (route param for detail navigation) */
    categoryId: number;
    xtreamId: number;
    type: 'movie' | 'series';
}
