import { inject } from '@angular/core';
import { Router } from '@angular/router';
import {
    TmdbCountryFacet,
    TmdbGenreFacet,
    TmdbMediaType,
    isTmdbYearFacet,
} from '@iptvnator/shared/interfaces';
import { discoverLink } from './discover-link.util';

/**
 * Where a detail page's facet chips should navigate. `null` means the page
 * cannot resolve its own playlist yet, so chips must not navigate at all.
 */
export interface DiscoverFacetTarget {
    portal: 'xtream' | 'stalker';
    mediaType: TmdbMediaType;
    playlistId: string;
}

export interface DiscoverFacetNavigation {
    canOpenYear(
        tmdbId: unknown,
        releaseDate: string | null | undefined
    ): boolean;
    openYear(tmdbId: unknown, releaseDate: string | null | undefined): void;
    openGenre(genre: TmdbGenreFacet): void;
    openCountry(country: TmdbCountryFacet): void;
}

/**
 * Year stated by a provider date field, whatever shape it arrives in —
 * `1976`, `1999-03-31` and `31-03-1999` all resolve. Reads the first
 * four-digit run rather than a fixed slice, which the day-first form
 * would otherwise turn into `NaN`, and rejects the `0000-00-00`
 * placeholder rather than offering a chip that filters by nothing.
 */
function facetYear(releaseDate: string | null | undefined): number | null {
    const match = releaseDate?.match(/\d{4}/);
    const year = match ? Number(match[0]) : null;
    return year !== null && isTmdbYearFacet(year) ? year : null;
}

/**
 * Shared behavior behind the clickable year/genre/country chips on every
 * detail page. Call it from a field initializer (injection context).
 *
 * The year gate is deliberately `typeof tmdbId === 'number'`: provider
 * payloads ship `tmdb_id` as an untrusted string, so only a value written
 * by the TMDB merge proves the item was actually matched — and without a
 * match there is no facet identity to discover by.
 */
export function createDiscoverFacetNavigation(
    target: () => DiscoverFacetTarget | null
): DiscoverFacetNavigation {
    const router = inject(Router);

    const navigate = (
        facet: Parameters<typeof discoverLink>[3]
    ): void => {
        const resolved = target();
        if (!resolved) {
            return;
        }
        const link = discoverLink(
            resolved.portal,
            resolved.playlistId,
            resolved.mediaType,
            facet
        );
        void router.navigate(link.commands, {
            queryParams: link.queryParams,
        });
    };

    const canOpenYear = (
        tmdbId: unknown,
        releaseDate: string | null | undefined
    ): boolean => typeof tmdbId === 'number' && facetYear(releaseDate) !== null;

    return {
        canOpenYear,
        openYear(tmdbId, releaseDate) {
            const year = facetYear(releaseDate);
            if (year === null || !canOpenYear(tmdbId, releaseDate)) {
                return;
            }
            navigate({ kind: 'year', year });
        },
        openGenre(genre) {
            navigate({ kind: 'genre', genre });
        },
        openCountry(country) {
            navigate({ kind: 'country', country });
        },
    };
}
