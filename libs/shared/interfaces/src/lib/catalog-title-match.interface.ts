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
    /**
     * Release-year tag stripped from the matched catalog title when the
     * match happened on the year-stripped tier ("The Matrix 1999" matching
     * the query "The Matrix"), null for exact-title matches. Consumers
     * with a known query year must reject incompatible years — this keeps
     * "Blade Runner" from claiming a catalog "Blade Runner 2049".
     */
    trailingYear: number | null;
}
