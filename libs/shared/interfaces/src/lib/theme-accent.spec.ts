import {
    normalizeThemeAccent,
    resolveThemeAccentHex,
    THEME_ACCENTS,
} from './theme-accent';

describe('theme accents', () => {
    it('keeps the saved accent ids stable', () => {
        expect(THEME_ACCENTS.map((accent) => accent.id)).toEqual([
            'blue',
            'teal',
            'green',
            'amber',
            'coral',
            'magenta',
            'violet',
        ]);
    });

    it.each([undefined, null, '', 'chartreuse', 3])(
        'treats %p as the theme colour',
        (value) => {
            expect(normalizeThemeAccent(value)).toBeNull();
            expect(resolveThemeAccentHex(value)).toBeNull();
        }
    );

    it('resolves a saved accent to its colour', () => {
        expect(normalizeThemeAccent('teal')).toBe('teal');
        expect(resolveThemeAccentHex('teal')).toBe('#14b8a6');
    });
});
