import { APP_ICONS, favoriteIcon } from './app-icons';

describe('APP_ICONS', () => {
    it('draws favourites as hearts and ratings as stars', () => {
        expect(APP_ICONS.favorite).toBe('favorite');
        expect(APP_ICONS.favoriteOutline).toBe('favorite_border');
        expect(APP_ICONS.rating).toBe('star');
        expect(APP_ICONS.ratingOutline).toBe('star_outline');
    });

    it('fills the heart only for a favourite', () => {
        expect(favoriteIcon(true)).toBe('favorite');
        expect(favoriteIcon(false)).toBe('favorite_border');
        expect(favoriteIcon(null)).toBe('favorite_border');
        expect(favoriteIcon(undefined)).toBe('favorite_border');
    });
});
