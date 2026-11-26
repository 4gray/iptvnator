import {
    isParentalLockPlaylistLocksEmpty,
    normalizeParentalLockGroupTitles,
    isWellFormedParentalLockStore,
    lockedStalkerCategoryIds,
    lockedXtreamCategoryIds,
    normalizeParentalLockPlaylistLocks,
    normalizeParentalLockStore,
    parentalLockSetKey,
    toParentalLockStalkerCategoryType,
    toParentalLockXtreamCategoryType,
} from './parental-lock.util';

describe('parental-lock.util', () => {
    describe('normalizeParentalLockPlaylistLocks', () => {
        it('keeps well-formed entries and drops junk, duplicates and the All pseudo-genre', () => {
            const locks = normalizeParentalLockPlaylistLocks({
                xtream: [
                    { categoryType: 'live', xtreamId: 7 },
                    { categoryType: 'live', xtreamId: '7' },
                    { categoryType: 'movies', xtreamId: 'abc' },
                    { categoryType: 'unknown', xtreamId: 1 },
                    null,
                ],
                stalker: [
                    { categoryType: 'itv', categoryId: 12 },
                    { categoryType: 'itv', categoryId: '12' },
                    { categoryType: 'vod', categoryId: '*' },
                    { categoryType: 'radio', categoryId: '' },
                ],
                m3u: ['Adult', 'Adult', 42, 'News'],
            });

            expect(locks).toEqual({
                xtream: [{ categoryType: 'live', xtreamId: 7 }],
                stalker: [{ categoryType: 'itv', categoryId: '12' }],
                m3u: ['Adult', 'News'],
            });
        });

        it('returns empty locks for non-objects', () => {
            expect(normalizeParentalLockPlaylistLocks(null)).toEqual({
                xtream: [],
                stalker: [],
                m3u: [],
            });
            expect(normalizeParentalLockPlaylistLocks('x')).toEqual({
                xtream: [],
                stalker: [],
                m3u: [],
            });
        });
    });

    describe('normalizeParentalLockStore', () => {
        it('drops playlists that lock nothing', () => {
            const store = normalizeParentalLockStore({
                'p-1': { m3u: ['XXX'] },
                'p-2': { xtream: [], stalker: [], m3u: [] },
                '': { m3u: ['ignored'] },
                'p-3': 'junk',
            });

            expect(Object.keys(store)).toEqual(['p-1']);
            expect(isParentalLockPlaylistLocksEmpty(store['p-1'])).toBe(false);
        });

        it('returns an empty store for anything that is not an object', () => {
            expect(normalizeParentalLockStore(undefined)).toEqual({});
            expect(normalizeParentalLockStore([])).toEqual({});
        });
    });

    describe('id lookups', () => {
        const locks = normalizeParentalLockPlaylistLocks({
            xtream: [
                { categoryType: 'live', xtreamId: 1 },
                { categoryType: 'movies', xtreamId: 2 },
            ],
            stalker: [
                { categoryType: 'itv', categoryId: '10' },
                { categoryType: 'series', categoryId: '11' },
            ],
        });

        it('filters Xtream ids by category type', () => {
            expect(lockedXtreamCategoryIds(locks, 'live')).toEqual([1]);
            expect(lockedXtreamCategoryIds(locks, 'series')).toEqual([]);
            expect(lockedXtreamCategoryIds(undefined, 'live')).toEqual([]);
        });

        it('filters Stalker ids by section', () => {
            expect(lockedStalkerCategoryIds(locks, 'itv')).toEqual(['10']);
            expect(lockedStalkerCategoryIds(locks, 'vod')).toEqual([]);
        });
    });

    describe('section mapping', () => {
        it('maps Xtream route sections to DB category types', () => {
            expect(toParentalLockXtreamCategoryType('live')).toBe('live');
            expect(toParentalLockXtreamCategoryType('vod')).toBe('movies');
            expect(toParentalLockXtreamCategoryType('movies')).toBe('movies');
            expect(toParentalLockXtreamCategoryType('series')).toBe('series');
            expect(toParentalLockXtreamCategoryType('search')).toBeNull();
        });

        it('accepts only Stalker sections with a genre list', () => {
            expect(toParentalLockStalkerCategoryType('itv')).toBe('itv');
            expect(toParentalLockStalkerCategoryType('radio')).toBe('radio');
            expect(toParentalLockStalkerCategoryType('favorites')).toBeNull();
            expect(toParentalLockStalkerCategoryType(undefined)).toBeNull();
        });
    });
});

describe('isWellFormedParentalLockStore', () => {
    it('accepts what writeLocks produces, lists present even when empty', () => {
        expect(isWellFormedParentalLockStore({})).toBe(true);
        expect(
            isWellFormedParentalLockStore({
                p: {
                    xtream: [{ categoryType: 'live', xtreamId: 7 }],
                    stalker: [{ categoryType: 'itv', categoryId: '9' }],
                    m3u: ['Adult'],
                },
                q: { xtream: [], stalker: [], m3u: [] },
            })
        ).toBe(true);
    });

    it.each([
        ['a non-object root', []],
        ['a non-object playlist entry', { p: 'corrupt' }],
        ['a playlist entry missing a list', { p: { xtream: [], m3u: [] } }],
        ['an empty playlist entry', { p: {} }],
        [
            'a non-list lock field',
            { p: { xtream: 'corrupt', stalker: [], m3u: [] } },
        ],
        [
            'a non-string group title',
            { p: { xtream: [], stalker: [], m3u: [1] } },
        ],
        [
            'an unknown category type',
            {
                p: {
                    xtream: [{ categoryType: 'x', xtreamId: 1 }],
                    stalker: [],
                    m3u: [],
                },
            },
        ],
        [
            'a non-numeric xtream id',
            {
                p: {
                    xtream: [{ categoryType: 'live', xtreamId: 'nope' }],
                    stalker: [],
                    m3u: [],
                },
            },
        ],
        [
            'the Stalker "all" pseudo id',
            {
                p: {
                    xtream: [],
                    stalker: [{ categoryType: 'itv', categoryId: '*' }],
                    m3u: [],
                },
            },
        ],
    ])('rejects %s', (_, value) => {
        expect(isWellFormedParentalLockStore(value)).toBe(false);
    });
});

describe('normalizeParentalLockGroupTitles', () => {
    it('deduplicates exactly, keeping surrounding whitespace', () => {
        expect(
            normalizeParentalLockGroupTitles([' Adult ', ' Adult ', 'Adult', 7])
        ).toEqual([' Adult ', 'Adult']);
    });

    describe('parentalLockSetKey', () => {
        const locks = {
            xtream: [
                { categoryType: 'live' as const, xtreamId: 7 },
                { categoryType: 'movies' as const, xtreamId: 8 },
            ],
            stalker: [{ categoryType: 'itv' as const, categoryId: '3' }],
            m3u: ['Synthetic A', 'Synthetic B'],
        };
        const empty = { xtream: [], stalker: [], m3u: [] };

        it('ignores the order of entries and of sources', () => {
            const reordered = {
                xtream: [...locks.xtream].reverse(),
                stalker: locks.stalker,
                m3u: [...locks.m3u].reverse(),
            };

            expect(parentalLockSetKey({ 'pl-1': reordered }, 'pl-1')).toBe(
                parentalLockSetKey({ 'pl-1': locks }, 'pl-1')
            );
            expect(
                parentalLockSetKey({ 'pl-2': locks, 'pl-1': empty }, null)
            ).toBe(parentalLockSetKey({ 'pl-2': reordered }, null));
        });

        it('changes with what a source, or any source, locks', () => {
            const store = { 'pl-1': locks };
            const more = {
                'pl-1': locks,
                'pl-2': { ...empty, m3u: ['Synthetic C'] },
            };

            expect(parentalLockSetKey(more, 'pl-1')).toBe(
                parentalLockSetKey(store, 'pl-1')
            );
            expect(parentalLockSetKey(more, null)).not.toBe(
                parentalLockSetKey(store, null)
            );
            expect(
                parentalLockSetKey({ 'pl-1': { ...locks, m3u: [] } }, 'pl-1')
            ).not.toBe(parentalLockSetKey(store, 'pl-1'));
        });
    });
});
