import {
    buildDashboardTmdbAttempts,
    dashboardTmdbLookupKey,
    type DashboardTmdbLookupItem,
} from './dashboard-tmdb-lookup.util';

function xtreamItem(
    overrides: Partial<DashboardTmdbLookupItem> = {}
): DashboardTmdbLookupItem {
    return {
        title: 'Inside Out',
        type: 'movie',
        source: 'xtream',
        ...overrides,
    };
}

describe('buildDashboardTmdbAttempts', () => {
    describe('without stored identity', () => {
        it('falls back to the display title alone', () => {
            expect(buildDashboardTmdbAttempts(xtreamItem())).toEqual([
                {
                    mediaType: 'movie',
                    title: 'Inside Out',
                    originalTitle: undefined,
                    tmdbId: undefined,
                    year: null,
                },
            ]);
        });

        it('still reads a year out of the title', () => {
            const [attempt] = buildDashboardTmdbAttempts(
                xtreamItem({ title: 'Subedaar (2026)' })
            );

            expect(attempt.year).toBe(2026);
        });
    });

    describe('with identity a detail view stored', () => {
        it('carries the provider year, the original title and the id', () => {
            const [attempt] = buildDashboardTmdbAttempts(
                xtreamItem({
                    tmdb_id: 150540,
                    release_year: 2015,
                    original_title: 'Inside Out',
                })
            );

            expect(attempt).toEqual({
                mediaType: 'movie',
                title: 'Inside Out',
                originalTitle: 'Inside Out',
                tmdbId: 150540,
                year: 2015,
            });
        });

        it('prefers the stored year over one found in the title', () => {
            // "2001: A Space Odyssey" is a 1968 film. Reading the year out of
            // the title makes every genuine copy fail the confidence gate, so
            // a stated provider year has to win.
            const [attempt] = buildDashboardTmdbAttempts(
                xtreamItem({
                    title: '2001: A Space Odyssey',
                    release_year: 1968,
                })
            );

            expect(attempt.year).toBe(1968);
        });

        it('keeps the title fallback when the provider stated no year', () => {
            // An absent column means the provider gave no date, NOT that the
            // year is unknowable — the title may still state one.
            const [attempt] = buildDashboardTmdbAttempts(
                xtreamItem({ title: 'Subedaar (2026)', tmdb_id: 1262547 })
            );

            expect(attempt.year).toBe(2026);
        });

        it.each([
            ['a zero id', { tmdb_id: 0 }],
            ['a negative id', { tmdb_id: -1 }],
            ['an implausible year', { release_year: 12 }],
            ['a blank original title', { original_title: '   ' }],
        ])('ignores %s', (_label, overrides) => {
            const [attempt] = buildDashboardTmdbAttempts(
                xtreamItem(overrides)
            );

            expect(attempt.tmdbId).toBeUndefined();
            expect(attempt.year).toBeNull();
            expect(attempt.originalTitle).toBeUndefined();
        });

        it('does not add a tv retry for an xtream movie', () => {
            // The xtream catalog files movies and series apart, so 'movie' is
            // evidence rather than a default.
            expect(
                buildDashboardTmdbAttempts(xtreamItem({ tmdb_id: 150540 }))
            ).toHaveLength(1);
        });

        it('lets a stalker entry win over stored columns', () => {
            const attempts = buildDashboardTmdbAttempts({
                title: 'Ignored',
                type: 'movie',
                source: 'stalker',
                tmdb_id: 999,
                release_year: 1999,
                stalker_item: {
                    category_id: 'series',
                    info: { name: 'The Mandalorian', releasedate: '2019' },
                } as never,
            });

            expect(attempts[0]).toMatchObject({
                mediaType: 'tv',
                title: 'The Mandalorian',
                year: 2019,
            });
            expect(attempts[0].tmdbId).toBeUndefined();
        });
    });

    describe('lookup identity', () => {
        it('changes once a detail view has stored identity', () => {
            // Callers memoize on this key, so a row that has since learned its
            // id must not keep serving the answer from its title-only lookup.
            expect(dashboardTmdbLookupKey(xtreamItem())).not.toEqual(
                dashboardTmdbLookupKey(
                    xtreamItem({ tmdb_id: 150540, release_year: 2015 })
                )
            );
        });

        it('is stable for the same stored identity', () => {
            const item = xtreamItem({
                tmdb_id: 150540,
                release_year: 2015,
                original_title: 'Inside Out',
            });

            expect(dashboardTmdbLookupKey(item)).toEqual(
                dashboardTmdbLookupKey({ ...item })
            );
        });
    });
});
