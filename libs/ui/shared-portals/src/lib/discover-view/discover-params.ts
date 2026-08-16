import { TmdbMediaType, isTmdbYearFacet } from '@iptvnator/shared/interfaces';

/**
 * Facets of a portal Discover page, parsed from route query params.
 * Labels are display-only companions of their filter values; a label
 * without its value is dropped, so the page never promises a filter it
 * cannot send. `type` and `genreId` form an atomic pair — movie and TV
 * genre id spaces differ, so a genre never survives a type flip.
 */
export interface DiscoverRouteParams {
    type: TmdbMediaType;
    year: number | null;
    genreId: number | null;
    genreLabel: string | null;
    countryCode: string | null;
    countryLabel: string | null;
}

/** Router-free query-param shape (Angular's `Params` is `any`-valued) */
type RawParams = Record<string, unknown>;

function rawString(params: RawParams, key: string): string | null {
    const value = params[key];
    return typeof value === 'string' && value.trim() !== ''
        ? value.trim()
        : null;
}

export function parseDiscoverParams(params: RawParams): DiscoverRouteParams {
    const type: TmdbMediaType =
        rawString(params, 'type') === 'tv' ? 'tv' : 'movie';

    // `0000` parses as four digits but filters by nothing — a deep link
    // must not reach a state the chips themselves refuse to offer
    const rawYear = rawString(params, 'year');
    const parsedYear =
        rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null;
    const year =
        parsedYear !== null && isTmdbYearFacet(parsedYear) ? parsedYear : null;

    const rawGenre = rawString(params, 'genre');
    const parsedGenre = rawGenre && /^\d+$/.test(rawGenre) ? Number(rawGenre) : null;
    const genreId = parsedGenre && parsedGenre > 0 ? parsedGenre : null;

    const rawCountry = rawString(params, 'country');
    const countryCode =
        rawCountry && /^[A-Za-z]{2}$/.test(rawCountry)
            ? rawCountry.toUpperCase()
            : null;

    return {
        type,
        year,
        genreId,
        genreLabel: genreId !== null ? rawString(params, 'genreLabel') : null,
        countryCode,
        countryLabel:
            countryCode !== null ? rawString(params, 'countryLabel') : null,
    };
}

export function hasDiscoverFacet(facets: DiscoverRouteParams): boolean {
    return (
        facets.year !== null ||
        facets.genreId !== null ||
        facets.countryCode !== null
    );
}

/**
 * Stable identity of one facet set. Used as the staleness-guard token by
 * the route containers (facets change via query params on the same route
 * instance, so a late response must be dropped by key, not by instance).
 */
export function discoverFacetKey(facets: DiscoverRouteParams): string {
    return [
        facets.type,
        facets.year ?? '',
        facets.genreId ?? '',
        facets.countryCode ?? '',
    ].join('|');
}
