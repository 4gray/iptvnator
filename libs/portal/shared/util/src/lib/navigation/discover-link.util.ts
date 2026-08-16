import {
    TmdbCountryFacet,
    TmdbGenreFacet,
    TmdbMediaType,
} from '@iptvnator/shared/interfaces';

/**
 * One metadata chip click on a detail page (year, genre or country),
 * resolved into the portal Discover route. Kept in one place so the four
 * chip render sites cannot drift in how they assemble the query params.
 */
export type DiscoverFacetClick =
    | { kind: 'year'; year: number }
    | { kind: 'genre'; genre: TmdbGenreFacet }
    | { kind: 'country'; country: TmdbCountryFacet };

export interface DiscoverLink {
    commands: (string | number)[];
    queryParams: Record<string, string>;
}

export function discoverLink(
    portal: 'xtream' | 'stalker',
    playlistId: string,
    type: TmdbMediaType,
    facet: DiscoverFacetClick
): DiscoverLink {
    const queryParams: Record<string, string> = { type };
    switch (facet.kind) {
        case 'year':
            queryParams['year'] = String(facet.year);
            break;
        case 'genre':
            queryParams['genre'] = String(facet.genre.id);
            queryParams['genreLabel'] = facet.genre.name;
            break;
        case 'country':
            queryParams['country'] = facet.country.code;
            queryParams['countryLabel'] = facet.country.name;
            break;
    }
    return {
        commands: [
            '/workspace',
            portal === 'xtream' ? 'xtreams' : 'stalker',
            playlistId,
            'discover',
        ],
        queryParams,
    };
}
