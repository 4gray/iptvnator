import { assessProviderId } from './tmdb-matcher';

describe('assessProviderId', () => {
    it('corroborates on a matching year even when the title reads wrong', () => {
        // "IT - Chapter Two" normalizes to "chapter two" because the
        // ALL-CAPS "IT" looks like a language tag
        expect(
            assessProviderId(
                {
                    title: 'It Chapter Two',
                    release_date: '2019-09-04',
                },
                { title: 'IT - Chapter Two', year: 2019 },
                'movie'
            )
        ).toBe('corroborated');
    });

    it('is inconclusive when the title differs and no year can arbitrate', () => {
        // Never 'contradicted': normalization artifacts and localized
        // titles both land here, and the id is usually fine
        expect(
            assessProviderId(
                { title: 'It Chapter Two' },
                { title: 'IT - Chapter Two' },
                'movie'
            )
        ).toBe('inconclusive');
    });

    it('contradicts a same-title id from another year', () => {
        // Both normalize to "blade runner" — only the year sees the swap
        expect(
            assessProviderId(
                { title: 'Blade Runner', release_date: '1982-06-25' },
                { title: 'Blade Runner 2049', year: 2017 },
                'movie'
            )
        ).toBe('contradicted');
    });

    it('reads the year out of the provider title when there is no field', () => {
        expect(
            assessProviderId(
                { title: 'The Lion King', release_date: '1994-06-24' },
                { title: 'The Lion King 2019' },
                'movie'
            )
        ).toBe('contradicted');
    });

    it('allows a one-year drift between provider and TMDB dates', () => {
        expect(
            assessProviderId(
                { title: 'Some Film', release_date: '2018-12-28' },
                { title: 'Totally Other Name', year: 2019 },
                'movie'
            )
        ).toBe('corroborated');
    });

    it('accepts a series that premiered before the reported season year', () => {
        // Portals report the current season's year, TMDB the premiere
        expect(
            assessProviderId(
                { name: 'The Boys', first_air_date: '2019-07-25' },
                { title: 'The Boys', year: 2026 },
                'tv'
            )
        ).toBe('corroborated');
    });

    it('contradicts a series that started after the reported year', () => {
        expect(
            assessProviderId(
                { name: 'Something Else', first_air_date: '2024-01-01' },
                { title: 'The Boys', year: 2019 },
                'tv'
            )
        ).toBe('contradicted');
    });

    it('corroborates on the title when neither side has a year', () => {
        expect(
            assessProviderId(
                { title: 'The Matrix' },
                { title: 'The Matrix' },
                'movie'
            )
        ).toBe('corroborated');
    });
});
