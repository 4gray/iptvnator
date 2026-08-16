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
 * Where a detail page's facet chips should navigate. `null` means the
 * page cannot send a facet anywhere — it has no playlist yet, or TMDB
 * enrichment is off, which is what Discover reads its results from.
 */
export interface DiscoverFacetTarget {
    portal: 'xtream' | 'stalker';
    mediaType: TmdbMediaType;
    playlistId: string;
}

export interface DiscoverFacetNavigation {
    /**
     * The year a chip should DISPLAY, so its label and its destination
     * cannot disagree — a day-first `31-03-1999` navigates to 1999 and
     * must not render as the first four characters. `null` when the date
     * states no usable year; the caller then keeps its own rendering.
     */
    yearLabel(releaseDate: string | null | undefined): string | null;
    canOpenYear(releaseDate: string | null | undefined): boolean;
    openYear(releaseDate: string | null | undefined): void;
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
 * A chip is offered only when its click can actually land somewhere, which
 * is what the target answers. Genre and country chips are inherently safe
 * (they exist only on an enriched item), but the year chip renders from
 * provider data, so the target is what keeps it from promising a Discover
 * page that enrichment cannot fill.
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

    const canOpenYear = (releaseDate: string | null | undefined): boolean =>
        target() !== null && facetYear(releaseDate) !== null;

    return {
        yearLabel(releaseDate) {
            const year = facetYear(releaseDate);
            return year === null ? null : String(year);
        },
        canOpenYear,
        openYear(releaseDate) {
            const year = facetYear(releaseDate);
            if (year !== null) {
                navigate({ kind: 'year', year });
            }
        },
        openGenre(genre) {
            navigate({ kind: 'genre', genre });
        },
        openCountry(country) {
            navigate({ kind: 'country', country });
        },
    };
}
