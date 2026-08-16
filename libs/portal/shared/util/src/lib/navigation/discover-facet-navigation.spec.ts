import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import {
    DiscoverFacetTarget,
    createDiscoverFacetNavigation,
} from './discover-facet-navigation';

describe('createDiscoverFacetNavigation', () => {
    let navigate: jest.Mock;

    function create(target: () => DiscoverFacetTarget | null) {
        const injector = Injector.create({
            providers: [{ provide: Router, useValue: { navigate } }],
        });
        return runInInjectionContext(injector, () =>
            createDiscoverFacetNavigation(target)
        );
    }

    const xtreamMovie = (): DiscoverFacetTarget => ({
        portal: 'xtream',
        mediaType: 'movie',
        playlistId: 'pl-1',
    });

    beforeEach(() => {
        navigate = jest.fn();
    });

    it('navigates to the portal-scoped discover route for a genre', () => {
        create(xtreamMovie).openGenre({ id: 18, name: 'Drama' });

        expect(navigate).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'pl-1', 'discover'],
            {
                queryParams: {
                    type: 'movie',
                    genre: '18',
                    genreLabel: 'Drama',
                },
            }
        );
    });

    it('routes Stalker targets to the stalker segment and media type', () => {
        create(() => ({
            portal: 'stalker',
            mediaType: 'tv',
            playlistId: 'pl-2',
        })).openCountry({ code: 'DE', name: 'Germany' });

        expect(navigate).toHaveBeenCalledWith(
            ['/workspace', 'stalker', 'pl-2', 'discover'],
            {
                queryParams: {
                    type: 'tv',
                    country: 'DE',
                    countryLabel: 'Germany',
                },
            }
        );
    });

    it('reads the year out of any provider date shape', () => {
        const discover = create(xtreamMovie);

        // Day-first dates are why this is a search, not a fixed slice
        for (const [date, year] of [
            ['1976', '1976'],
            ['1999-03-31', '1999'],
            ['31-03-1999', '1999'],
        ]) {
            navigate.mockClear();
            discover.openYear(date);
            expect(navigate).toHaveBeenCalledWith(expect.anything(), {
                queryParams: { type: 'movie', year },
            });
        }
    });

    it('labels the chip with the year it navigates to', () => {
        const discover = create(xtreamMovie);

        // The label and the destination must not disagree: slicing the
        // first four characters of a day-first date renders '31-0'
        expect(discover.yearLabel('31-03-1999')).toBe('1999');
        expect(discover.yearLabel('1999-03-31')).toBe('1999');
        expect(discover.yearLabel('1976')).toBe('1976');
    });

    it('has no label for a date stating no usable year', () => {
        const discover = create(xtreamMovie);

        expect(discover.yearLabel('0000-00-00')).toBeNull();
        expect(discover.yearLabel('unknown')).toBeNull();
        expect(discover.yearLabel(undefined)).toBeNull();
    });

    it('refuses the year facet when the target cannot be reached', () => {
        // Hosts return null when enrichment is off, and Discover reads its
        // results from TMDB — a year chip must not promise an empty page
        const discover = create(() => null);

        expect(discover.canOpenYear('1999-03-31')).toBe(false);

        discover.openYear('1999-03-31');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('refuses the year facet without a parsable year', () => {
        const discover = create(xtreamMovie);

        expect(discover.canOpenYear('')).toBe(false);
        expect(discover.canOpenYear(undefined)).toBe(false);
        expect(discover.canOpenYear('unknown')).toBe(false);

        discover.openYear('unknown');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('refuses the zero-date placeholder providers ship for "no date"', () => {
        const discover = create(xtreamMovie);

        // '0000-00-00' reads as a four-digit year but filters by nothing
        expect(discover.canOpenYear('0000-00-00')).toBe(false);
        expect(discover.canOpenYear('0000')).toBe(false);

        discover.openYear('0000-00-00');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('does not navigate while the host cannot resolve its playlist', () => {
        const discover = create(() => null);

        discover.openGenre({ id: 18, name: 'Drama' });
        discover.openCountry({ code: 'US', name: 'United States' });
        discover.openYear('1999');

        expect(navigate).not.toHaveBeenCalled();
    });

    it('re-reads the target on every click', () => {
        let target: DiscoverFacetTarget | null = null;
        const discover = create(() => target);

        discover.openGenre({ id: 18, name: 'Drama' });
        expect(navigate).not.toHaveBeenCalled();

        target = xtreamMovie();
        discover.openGenre({ id: 18, name: 'Drama' });
        expect(navigate).toHaveBeenCalledTimes(1);
    });
});
