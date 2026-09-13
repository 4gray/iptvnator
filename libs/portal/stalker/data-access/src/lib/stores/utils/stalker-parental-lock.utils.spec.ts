import {
    isStalkerItemWithheld,
    withoutWithheldStalkerItems,
} from './stalker-parental-lock.utils';

describe('stalker-parental-lock.utils', () => {
    const withheld = new Set(['7', '9']);

    it('reads the genre from tv_genre_id for live and radio rows', () => {
        expect(isStalkerItemWithheld({ tv_genre_id: 7 }, 'itv', withheld)).toBe(
            true
        );
        expect(
            isStalkerItemWithheld({ tv_genre_id: '9' }, 'radio', withheld)
        ).toBe(true);
        expect(isStalkerItemWithheld({ tv_genre_id: 8 }, 'itv', withheld)).toBe(
            false
        );
        // A VOD row with a matching category_id is not a live row.
        expect(
            isStalkerItemWithheld({ category_id: '7' }, 'itv', withheld)
        ).toBe(false);
    });

    it('reads category_id for VOD and series rows', () => {
        expect(
            isStalkerItemWithheld({ category_id: '7' }, 'vod', withheld)
        ).toBe(true);
        expect(
            isStalkerItemWithheld({ category_id: 9 }, 'series', withheld)
        ).toBe(true);
        expect(isStalkerItemWithheld({}, 'vod', withheld)).toBe(false);
    });

    it('returns the same array when nothing is withheld', () => {
        const items = [{ category_id: '7' }];
        expect(withoutWithheldStalkerItems(items, 'vod', new Set())).toBe(
            items
        );
        expect(withoutWithheldStalkerItems(items, 'vod', withheld)).toEqual([]);
    });
});
