/**
 * Shared contracts for the TMDB metadata enrichment subsystem.
 *
 * The renderer talks to the TMDB API directly (it supports CORS); these
 * types describe the user-facing settings and the cache rows persisted in
 * SQLite (Electron) or kept in memory (PWA).
 */

export type TmdbMediaType = 'movie' | 'tv';

/**
 * Opt-in TMDB enrichment settings. Enrichment sends movie/series titles to
 * TMDB, so it is disabled by default for privacy.
 */
export interface TmdbSettings {
    enabled: boolean;
    /** Optional user-provided API key overriding the embedded default */
    apiKey?: string;
}

export const DEFAULT_TMDB_SETTINGS: TmdbSettings = {
    enabled: false,
    apiKey: '',
};

/**
 * Cast member attached to provider detail objects after TMDB enrichment.
 * Rendered as avatar chips in the VOD/series detail views.
 */
export interface TmdbEnrichedCastMember {
    name: string;
    character?: string;
    /** Full TMDB profile image URL, `null` when the actor has no photo */
    profileUrl: string | null;
    /** TMDB person id — makes the cast chip clickable (actor page) */
    tmdbPersonId?: number;
}

/**
 * A recommended/similar title attached to detail objects after TMDB
 * enrichment. Detail views match these against the provider catalog and
 * render a "Similar" rail from the hits.
 */
export interface TmdbRecommendation {
    tmdbId: number;
    title: string;
    year: number | null;
    posterUrl: string | null;
}

/**
 * One cached TMDB lookup. Two kinds of rows share the table, discriminated
 * by the `lookupKey` prefix:
 * - `id:<tmdbId>` — full details payload for a TMDB id
 * - `title:<normalized>|year:<year>` — search resolution result; a `null`
 *   `tmdbId` is a cached "no confident match" verdict (negative cache)
 */
export interface TmdbCacheEntry {
    mediaType: TmdbMediaType;
    lookupKey: string;
    /** TMDB language code the payload was fetched with, e.g. `en-US` */
    language: string;
    tmdbId: number | null;
    /** Raw JSON of the TMDB response, `null` for negative match rows */
    payload: string | null;
    /** ISO timestamp set by the persistence layer */
    fetchedAt?: string;
}
