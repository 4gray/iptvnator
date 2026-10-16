import { removesParentalLocks } from './parental-lock-store.util';

describe('removesParentalLocks', () => {
    const previous = {
        xtream: [{ categoryType: 'live' as const, xtreamId: 7 }],
        stalker: [{ categoryType: 'vod' as const, categoryId: '3' }],
        m3u: ['Adults'],
    };

    it('is false when every previous lock is kept, extra locks or not', () => {
        expect(removesParentalLocks(previous, previous)).toBe(false);
        expect(
            removesParentalLocks(previous, {
                ...previous,
                m3u: ['Adults', 'News'],
            })
        ).toBe(false);
    });

    it('is true when any portal list drops a lock', () => {
        expect(
            removesParentalLocks(previous, { ...previous, xtream: [] })
        ).toBe(true);
        expect(
            removesParentalLocks(previous, {
                ...previous,
                stalker: [{ categoryType: 'itv', categoryId: '3' }],
            })
        ).toBe(true);
        expect(removesParentalLocks(previous, { ...previous, m3u: [] })).toBe(
            true
        );
    });
});
