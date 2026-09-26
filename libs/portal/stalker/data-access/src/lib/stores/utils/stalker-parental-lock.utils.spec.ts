import {
    isStalkerItemWithheld,
    stalkerWithheldRowKey,
    withoutWithheldStalkerItems,
} from './stalker-parental-lock.utils';
import { ALL_CATEGORIES_WITHHELD } from '@iptvnator/shared/interfaces';

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

describe('isStalkerItemWithheld in fail-closed mode', () => {
    it('withholds rows without a genre only while everything is withheld', () => {
        expect(isStalkerItemWithheld({}, 'itv', ALL_CATEGORIES_WITHHELD)).toBe(
            true
        );
        expect(
            isStalkerItemWithheld(
                { name: 'x' } as never,
                'vod',
                ALL_CATEGORIES_WITHHELD
            )
        ).toBe(true);
        expect(isStalkerItemWithheld({}, 'itv', new Set(['9']))).toBe(false);
        expect(
            withoutWithheldStalkerItems(
                [{ tv_genre_id: '1' }, {}],
                'itv',
                ALL_CATEGORIES_WITHHELD
            )
        ).toEqual([]);
    });
});

describe('stalkerWithheldRowKey', () => {
    it('keys rows by whichever id field they carry, never by a shared empty string', () => {
        expect(stalkerWithheldRowKey({ id: 5 })).toBe('id:5');
        expect(stalkerWithheldRowKey({ stream_id: '6' })).toBe('id:6');
        expect(stalkerWithheldRowKey({ movie_id: 7 })).toBe('id:7');
        expect(stalkerWithheldRowKey({ series_id: 8 })).toBe('id:8');
        expect(stalkerWithheldRowKey({ cmd: 'ffmpeg http://a' })).not.toBe(
            stalkerWithheldRowKey({ cmd: 'ffmpeg http://b' })
        );
    });
});
