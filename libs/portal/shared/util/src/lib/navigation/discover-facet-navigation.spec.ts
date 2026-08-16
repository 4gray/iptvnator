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
            discover.openYear(603, date);
            expect(navigate).toHaveBeenCalledWith(expect.anything(), {
                queryParams: { type: 'movie', year },
            });
        }
    });

    it('refuses the year facet without a merge-written numeric tmdb id', () => {
        const discover = create(xtreamMovie);

        // Providers ship tmdb_id as an untrusted string; only the merge
        // writes a number, and only a matched item has a facet identity
        expect(discover.canOpenYear('603', '1999-03-31')).toBe(false);
        expect(discover.canOpenYear(undefined, '1999-03-31')).toBe(false);
        expect(discover.canOpenYear(603, '1999-03-31')).toBe(true);

        discover.openYear('603', '1999-03-31');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('refuses the year facet without a parsable year', () => {
        const discover = create(xtreamMovie);

        expect(discover.canOpenYear(603, '')).toBe(false);
        expect(discover.canOpenYear(603, undefined)).toBe(false);
        expect(discover.canOpenYear(603, 'unknown')).toBe(false);

        discover.openYear(603, 'unknown');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('does not navigate while the host cannot resolve its playlist', () => {
        const discover = create(() => null);

        discover.openGenre({ id: 18, name: 'Drama' });
        discover.openCountry({ code: 'US', name: 'United States' });
        discover.openYear(603, '1999');

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
