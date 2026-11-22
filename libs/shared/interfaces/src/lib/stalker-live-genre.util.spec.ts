import { getStalkerLiveRowGenre } from './stalker-live-genre.util';

describe('getStalkerLiveRowGenre', () => {
    it('prefers the live genre and preserves leading zeros when using the category fallback', () => {
        expect(
            getStalkerLiveRowGenre({ tv_genre_id: 0, category_id: '01' })
        ).toBe('0');
        expect(
            getStalkerLiveRowGenre(
                { tv_genre_id: ' ', category_id: ' 01 ' },
                '1'
            )
        ).toBe('01');
    });

    it('skips saved section markers and handles rows without genre metadata', () => {
        expect(getStalkerLiveRowGenre({ category_id: 'ITV' }, '02')).toBe('02');
        expect(getStalkerLiveRowGenre(null, 'Radio')).toBeNull();
        expect(getStalkerLiveRowGenre({})).toBeNull();
    });
});
