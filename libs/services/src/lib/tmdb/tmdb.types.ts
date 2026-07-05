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
    poster_path?: string | null;
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
    name: string;
    job?: string;
    department?: string;
}

export interface TmdbCredits {
    cast?: TmdbCastMember[];
    crew?: TmdbCrewMember[];
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
}

export interface TmdbMovieDetails extends TmdbDetailsBase {
    title?: string;
    original_title?: string;
    release_date?: string;
    runtime?: number;
    production_countries?: { iso_3166_1?: string; name?: string }[];
}

export interface TmdbTvDetails extends TmdbDetailsBase {
    name?: string;
    original_name?: string;
    first_air_date?: string;
    episode_run_time?: number[];
    created_by?: { name: string }[];
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

/** One acting credit from /person/{id} combined_credits */
export interface TmdbPersonCredit {
    id: number;
    media_type?: string;
    /** Movie credits */
    title?: string;
    release_date?: string;
    /** TV credits */
    name?: string;
    first_air_date?: string;
    character?: string;
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
    combined_credits?: { cast?: TmdbPersonCredit[] };
}

export type TmdbDetails = TmdbMovieDetails | TmdbTvDetails;

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
