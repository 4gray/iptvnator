import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import {
    CatalogTitleMatchService,
    groupTitleMatchesByKey,
    pickTitleMatch,
} from './catalog-title-match.service';
import { ParentalLockService } from './parental-lock/parental-lock.service';

describe('catalog title matching', () => {
    const match = (
        overrides: Partial<CatalogTitleMatch> = {}
    ): CatalogTitleMatch => ({
        queryTitle: 'Dune',
        playlistId: 'pl-1',
        playlistName: 'My Portal',
        categoryId: 7,
        xtreamId: 1,
        type: 'movie',
        trailingYear: null,
        ...overrides,
    });

    const pick = (
        lookup: {
            titles: string[];
            year: number | null;
            type?: 'movie' | 'series';
        },
        matches: CatalogTitleMatch[]
    ) =>
        pickTitleMatch(
            { type: lookup.type ?? 'movie', ...lookup },
            groupTitleMatchesByKey(matches)
        );

    describe('groupTitleMatchesByKey', () => {
        it('keeps every row sharing a key, in worker order', () => {
            const first = match({ trailingYear: 1984, xtreamId: 84 });
            const second = match({ trailingYear: 2021, xtreamId: 21 });

            expect(groupTitleMatchesByKey([first, second])).toEqual(
                new Map([['movie:dune', [first, second]]])
            );
        });

        it('separates the same title across media types', () => {
            const movie = match({ type: 'movie' });
            const series = match({ type: 'series' });

            expect([...groupTitleMatchesByKey([movie, series]).keys()]).toEqual(
                ['movie:dune', 'series:dune']
            );
        });
    });

    describe('pickTitleMatch', () => {
        it('prefers the row whose stripped year is the lookup year', () => {
            const picked = pick({ titles: ['Dune'], year: 2021 }, [
                match({ trailingYear: 1984, xtreamId: 84 }),
                match({ trailingYear: 2021, xtreamId: 21 }),
            ]);

            expect(picked?.xtreamId).toBe(21);
        });

        it('prefers the exact-year row over an untagged one', () => {
            // An untagged row merely fails to contradict the lookup; a row
            // carrying the year is positive evidence for this exact film.
            const picked = pick({ titles: ['Dune'], year: 2021 }, [
                match({ trailingYear: null, xtreamId: 7 }),
                match({ trailingYear: 2021, xtreamId: 21 }),
            ]);

            expect(picked?.xtreamId).toBe(21);
        });

        it('prefers an untagged row over a merely year-compatible one', () => {
            // No row states 2021. An untagged "Dune" does not contradict
            // the lookup at all, while a "Dune 2020" only survives on the
            // one-year drift — so the untagged row outranks it.
            const picked = pick({ titles: ['Dune'], year: 2021 }, [
                match({ trailingYear: 2020, xtreamId: 20 }),
                match({ trailingYear: null, xtreamId: 7 }),
            ]);

            expect(picked?.xtreamId).toBe(7);
        });

        it('prefers an untagged row when the lookup year is unknown', () => {
            const picked = pick({ titles: ['Dune'], year: null }, [
                match({ trailingYear: 1984, xtreamId: 84 }),
                match({ trailingYear: null, xtreamId: 7 }),
            ]);

            expect(picked?.xtreamId).toBe(7);
        });

        it('rejects every year-incompatible row', () => {
            expect(
                pick({ titles: ['Blade Runner'], year: 1982 }, [
                    match({ queryTitle: 'Blade Runner', trailingYear: 2049 }),
                ])
            ).toBeNull();
        });

        it('accepts a one-year drift', () => {
            expect(
                pick({ titles: ['Dune'], year: 2021 }, [
                    match({ trailingYear: 2020, xtreamId: 20 }),
                ])?.xtreamId
            ).toBe(20);
        });

        it('does not match across media types', () => {
            expect(
                pick({ titles: ['Dune'], year: 2021, type: 'series' }, [
                    match({ type: 'movie', trailingYear: 2021 }),
                ])
            ).toBeNull();
        });

        it('ranks by evidence across aliases, not by alias order', () => {
            // The localized title finds only an untagged row while the
            // original-title alias holds the row carrying the lookup's own
            // year — the better evidence must win regardless of which
            // alias found it.
            const picked = pick(
                { titles: ['The Hunt', 'Jagten'], year: 2012 },
                [
                    match({
                        queryTitle: 'The Hunt',
                        trailingYear: null,
                        xtreamId: 1,
                    }),
                    match({
                        queryTitle: 'Jagten',
                        trailingYear: 2012,
                        xtreamId: 2,
                    }),
                ]
            );

            expect(picked?.xtreamId).toBe(2);
        });

        it('falls back to the alias when the first alias is incompatible', () => {
            const picked = pick(
                { titles: ['The Hunt', 'Jagten'], year: 2012 },
                [
                    match({
                        queryTitle: 'The Hunt',
                        trailingYear: 2020,
                        xtreamId: 1,
                    }),
                    match({
                        queryTitle: 'Jagten',
                        trailingYear: null,
                        xtreamId: 2,
                    }),
                ]
            );

            expect(picked?.xtreamId).toBe(2);
        });

        it('breaks ties inside a tier by alias order', () => {
            const picked = pick(
                { titles: ['The Hunt', 'Jagten'], year: 2012 },
                [
                    match({
                        queryTitle: 'Jagten',
                        trailingYear: null,
                        xtreamId: 2,
                    }),
                    match({
                        queryTitle: 'The Hunt',
                        trailingYear: null,
                        xtreamId: 1,
                    }),
                ]
            );

            expect(picked?.xtreamId).toBe(1);
        });

        it('returns null when nothing matched the title at all', () => {
            expect(
                pick({ titles: ['Unmatched'], year: null }, [match()])
            ).toBeNull();
        });
    });
});

describe('CatalogTitleMatchService parental lock', () => {
    afterEach(() => {
        delete (window as { electron?: unknown }).electron;
    });

    it.each([false, true])(
        'asks the worker only while the lock does not withhold everything (%s)',
        async (withholds) => {
            const dbMatchTitles = jest.fn().mockResolvedValue([]);
            (window as { electron?: unknown }).electron = { dbMatchTitles };
            TestBed.configureTestingModule({
                providers: [
                    {
                        provide: ParentalLockService,
                        useValue: { withholdsEverything: signal(withholds) },
                    },
                ],
            });

            await TestBed.inject(CatalogTitleMatchService).matchTitles([
                'Dune',
            ]);

            expect(dbMatchTitles).toHaveBeenCalledTimes(withholds ? 0 : 1);
        }
    );

    it('filters cached matches by the lock state at read time', () => {
        const locked = signal(new Set<string>());
        const isXtreamCategoryLocked = jest.fn(
            (playlistId: string, type: string, categoryId: number) =>
                locked().has(`${playlistId}:${type}:${categoryId}`)
        );
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: ParentalLockService,
                    useValue: { isXtreamCategoryLocked },
                },
            ],
        });
        const service = TestBed.inject(CatalogTitleMatchService);
        const film = {
            queryTitle: 'Dune',
            playlistId: 'pl-1',
            playlistName: 'Portal',
            categoryId: 7,
            xtreamId: 1,
            type: 'movie' as const,
            trailingYear: null,
        };
        const show = { ...film, type: 'series' as const, xtreamId: 2 };
        const visible = computed(() => service.visibleMatches([film, show]));
        expect(visible()).toEqual([film, show]);

        // The film's category is locked: its category type is 'movies'.
        locked.set(new Set(['pl-1:movies:7']));
        expect(visible()).toEqual([show]);
    });
});
