/**
 * Shared contracts for the TMDB metadata enrichment subsystem.
 *
 * The renderer talks to the TMDB API directly (it supports CORS); these
 * types describe the user-facing settings and the cache rows persisted in
 * SQLite (Electron) or kept in memory (PWA).
 */

export type TmdbMediaType = 'movie' | 'tv';

/**
 * Row namespace in the shared metadata cache table. Besides movie/tv
 * details it also stores person payloads (`person:<id>` lookup keys).
 */
export type TmdbCacheMediaType = TmdbMediaType | 'person';

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
/**
 * Production status of a series, as a stable token. TMDB returns this
 * field as an ENGLISH string regardless of the request language, so the
 * raw value must never reach the UI — it is normalized here and rendered
 * through translated labels.
 */
export type TmdbSeriesStatus =
    | 'returning'
    | 'planned'
    | 'in-production'
    | 'ended'
    | 'canceled'
    | 'pilot';

const SERIES_STATUS_TOKENS: Record<string, TmdbSeriesStatus> = {
    'returning series': 'returning',
    planned: 'planned',
    'in production': 'in-production',
    ended: 'ended',
    canceled: 'canceled',
    cancelled: 'canceled',
    pilot: 'pilot',
};

/** `null` for unknown values — an unmapped status is simply not shown */
export function normalizeSeriesStatus(
    status: string | null | undefined
): TmdbSeriesStatus | null {
    const key = status?.trim().toLowerCase();
    return (key && SERIES_STATUS_TOKENS[key]) || null;
}

const SERIES_STATUS_LABEL_KEYS: Record<TmdbSeriesStatus, string> = {
    returning: 'XTREAM.SERIES_STATUS_RETURNING',
    planned: 'XTREAM.SERIES_STATUS_PLANNED',
    'in-production': 'XTREAM.SERIES_STATUS_IN_PRODUCTION',
    ended: 'XTREAM.SERIES_STATUS_ENDED',
    canceled: 'XTREAM.SERIES_STATUS_CANCELED',
    pilot: 'XTREAM.SERIES_STATUS_PILOT',
};

export function seriesStatusLabelKey(status: TmdbSeriesStatus): string {
    return SERIES_STATUS_LABEL_KEYS[status];
}

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
 * Genre as stated by TMDB for one title. The id drives the Discover-page
 * filter (`with_genres`), so it must never be mixed across media types —
 * movie and TV genre id spaces differ.
 */
export interface TmdbGenreFacet {
    id: number;
    name: string;
}

/**
 * Production country as stated by TMDB. `code` is ISO 3166-1 alpha-2 and
 * drives the Discover-page filter (`with_origin_country`); `name` is the
 * TMDB display name (English regardless of request language).
 */
export interface TmdbCountryFacet {
    code: string;
    name: string;
}

/**
 * Whether a number is a year the Discover page can actually filter by.
 *
 * Providers ship `0000-00-00` as their "no date" placeholder, which reads
 * as a four-digit year and would otherwise produce a `0000` chip that
 * filters by nothing. Shared by the chip side and the route-param side so
 * a deep link cannot smuggle in what a chip refuses to offer.
 */
export function isTmdbYearFacet(year: number): boolean {
    return Number.isInteger(year) && year >= 1000 && year <= 9999;
}

/**
 * The year stated by a provider date field, whatever shape it arrives in
 * — `1976`, `1999-03-31` and `31-03-1999` all resolve to the same year.
 *
 * Reads the first four-digit run rather than a fixed prefix: slicing
 * turns a day-first date into `31-0`, which is both the wrong label and
 * an unusable filter. Lives here so the Discover chips and the detail
 * adapters cannot drift into disagreeing about what a date says.
 */
export function parseFacetYear(
    releaseDate: string | null | undefined
): number | null {
    const match = releaseDate?.match(/\d{4}/);
    const year = match ? Number(match[0]) : null;
    return year !== null && isTmdbYearFacet(year) ? year : null;
}

/**
 * One cached TMDB lookup. Two kinds of rows share the table, discriminated
 * by the `lookupKey` prefix:
 * - `id:<tmdbId>` — full details payload for a TMDB id
 * - `title:<normalized>|year:<year>` — search resolution result; a `null`
 *   `tmdbId` is a cached "no confident match" verdict (negative cache)
 */
/** Size of the persisted TMDB cache, shown in the settings panel */
export interface TmdbCacheStats {
    entries: number;
    /** Total payload size in bytes */
    bytes: number;
}

export interface TmdbCacheEntry {
    mediaType: TmdbCacheMediaType;
    lookupKey: string;
    /** TMDB language code the payload was fetched with, e.g. `en-US` */
    language: string;
    tmdbId: number | null;
    /** Raw JSON of the TMDB response, `null` for negative match rows */
    payload: string | null;
    /** ISO timestamp set by the persistence layer */
    fetchedAt?: string;
}
