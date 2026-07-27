import {
    NEW_MARKETING_MOVIES,
    POSTER_SHOWCASE_MOVIES,
} from './shared-marketing-fixtures';

const EXPECTED_NEW_TITLES = [
    'Black Harbor',
    'The Paper Astronaut',
    'Summer Static',
    'House of Tides',
    'Open Late',
    'White Room Six',
    'Field Notes',
    'A Thousand Steps',
    'The Small Hours',
    'Copper Rain',
    'Willow Engine',
    'Quiet Thunder',
    'Parallel Kitchens',
    'First String',
    'The Long Museum',
    'Cloud Hotel',
    'Unpaid Overtime',
    'Deep Green',
    'November Radio',
    'The Last Orange',
];

describe('poster showcase marketing fixtures', () => {
    it('keeps the 20 new movies first in the approved order', () => {
        expect(NEW_MARKETING_MOVIES).toHaveLength(20);
        expect(NEW_MARKETING_MOVIES.map((movie) => movie.name)).toEqual(
            EXPECTED_NEW_TITLES
        );
        expect(
            POSTER_SHOWCASE_MOVIES.slice(0, EXPECTED_NEW_TITLES.length).map(
                (movie) => movie.name
            )
        ).toEqual(EXPECTED_NEW_TITLES);
    });

    it('exposes 35 unique titles and slugs', () => {
        expect(POSTER_SHOWCASE_MOVIES).toHaveLength(35);
        expect(
            new Set(POSTER_SHOWCASE_MOVIES.map((movie) => movie.name)).size
        ).toBe(35);
        expect(
            new Set(POSTER_SHOWCASE_MOVIES.map((movie) => movie.slug)).size
        ).toBe(35);
        expect(
            POSTER_SHOWCASE_MOVIES.every((movie) =>
                /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(movie.slug)
            )
        ).toBe(true);
    });

    it('uses only provider-neutral category keys', () => {
        const validCategoryKeys = new Set([
            'action-mystery',
            'future-fantasy',
            'family-comedy',
            'drama-documentary',
        ]);

        expect(
            POSTER_SHOWCASE_MOVIES.every((movie) =>
                validCategoryKeys.has(movie.categoryKey)
            )
        ).toBe(true);
    });
});
