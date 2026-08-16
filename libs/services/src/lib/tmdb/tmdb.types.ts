/**
 * Response shapes of the TMDB v3 API endpoints used for enrichment.
 * Only fields the app consumes are typed; payloads are cached verbatim so
 * later phases can pick up additional fields without refetching.
 */

export interface TmdbSearchResult {
    id: number;
    /** Movie results */
    title?: string;
    original_title?: string;
    release_date?: string;
    /** TV results */
    name?: string;
    original_name?: string;
    first_air_date?: string;
    popularity?: number;
    vote_count?: number;
    vote_average?: number;
    poster_path?: string | null;
}

/** One dashboard-ready trending title (movie or series) */
export interface TmdbTrendingEntry {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    year: number | null;
    posterUrl: string | null;
    /** vote_average rounded to one decimal, null without votes */
    rating: string | null;
    popularity: number;
}

export interface TmdbSearchResponse {
    results?: TmdbSearchResult[];
}

export interface TmdbCastMember {
    id?: number;
    name: string;
    character?: string;
    order?: number;
    profile_path?: string | null;
}

export interface TmdbCrewMember {
    id?: number;
    name: string;
    job?: string;
    department?: string;
    profile_path?: string | null;
}

export interface TmdbCredits {
    cast?: TmdbCastMember[];
    crew?: TmdbCrewMember[];
}

/**
 * `/tv/{id}/aggregate_credits` groups a person's work across the whole
 * run, so a character lives in `roles[]` rather than on the member.
 */
export interface TmdbAggregateCastMember {
    id?: number;
    name: string;
    order?: number;
    profile_path?: string | null;
    total_episode_count?: number;
    roles?: { character?: string; episode_count?: number }[];
}

export interface TmdbAggregateCredits {
    cast?: TmdbAggregateCastMember[];
}

export interface TmdbGenre {
    id: number;
    name: string;
}

export interface TmdbVideo {
    key: string;
    site?: string;
    type?: string;
    official?: boolean;
    name?: string;
    iso_639_1?: string;
}

interface TmdbDetailsBase {
    id: number;
    overview?: string;
    /** ISO 639-1 code of the content's original language ("ru") */
    original_language?: string;
    genres?: TmdbGenre[];
    vote_average?: number;
    vote_count?: number;
    poster_path?: string | null;
    backdrop_path?: string | null;
    credits?: TmdbCredits;
    videos?: { results?: TmdbVideo[] };
    recommendations?: { results?: TmdbSearchResult[] };
    /** Present on both /movie and /tv details payloads */
    production_countries?: { iso_3166_1?: string; name?: string }[];
    /**
     * ISO 3166-1 codes of the countries the title ORIGINATES from — a
     * subset of `production_countries` for co-productions. This is the
     * dimension `/discover`'s `with_origin_country` filters on, so it is
     * what a clickable country facet must be built from.
     */
    origin_country?: string[];
}

export interface TmdbMovieDetails extends TmdbDetailsBase {
    title?: string;
    original_title?: string;
    release_date?: string;
    runtime?: number;
}

export interface TmdbTvDetails extends TmdbDetailsBase {
    name?: string;
    original_name?: string;
    first_air_date?: string;
    /** English production status ("Ended", "Returning Series", ...) */
    status?: string;
    /** Series-wide cast; `credits` alone covers only the latest season */
    aggregate_credits?: TmdbAggregateCredits;
    episode_run_time?: number[];
    created_by?: {
        id?: number;
        name: string;
        profile_path?: string | null;
    }[];
}

export interface TmdbEpisode {
    episode_number: number;
    season_number?: number;
    name?: string;
    overview?: string;
    still_path?: string | null;
    air_date?: string;
    vote_average?: number;
    vote_count?: number;
    runtime?: number | null;
}

export interface TmdbSeasonDetails {
    season_number?: number;
    overview?: string;
    episodes?: TmdbEpisode[];
}

/** One credit from /person/{id} combined_credits (cast or crew) */
export interface TmdbPersonCredit {
    id: number;
    media_type?: string;
    /** Movie credits */
    title?: string;
    release_date?: string;
    /** TV credits */
    name?: string;
    first_air_date?: string;
    /** Acting credits (cast array) */
    character?: string;
    /** Crew credits (crew array) — e.g. "Director" / "Directing" */
    job?: string;
    department?: string;
    poster_path?: string | null;
    vote_count?: number;
    popularity?: number;
}

export interface TmdbPersonDetails {
    id: number;
    name?: string;
    biography?: string;
    birthday?: string | null;
    deathday?: string | null;
    place_of_birth?: string | null;
    profile_path?: string | null;
    combined_credits?: {
        cast?: TmdbPersonCredit[];
        crew?: TmdbPersonCredit[];
    };
}

export type TmdbDetails = TmdbMovieDetails | TmdbTvDetails;

/** `/discover/{movie,tv}` page; extends the search shape with paging */
export interface TmdbDiscoverResponse extends TmdbSearchResponse {
    page?: number;
    total_pages?: number;
}

/**
 * Facet filters for `/discover`. All optional — a single chip click sends
 * exactly one, but the shape supports combined queries for later versions.
 */
export interface TmdbDiscoverFilters {
    year?: number | null;
    genreId?: number | null;
    /** ISO 3166-1 alpha-2 */
    countryCode?: string | null;
}

/** Input for the enrichment orchestrator */
export interface TmdbEnrichmentQuery {
    /** Provider-supplied TMDB id — trusted fully when valid */
    tmdbId?: number | string | null;
    title: string;
    /** Original title, often cleaner than the display title */
    originalTitle?: string | null;
    /** Release year used to disambiguate fuzzy matches */
    year?: number | null;
}
