import { Theme } from './theme.enum';
import {
    normalizeTheme,
    resolveThemePreset,
    THEME_PRESETS,
} from './theme-presets';

describe('theme presets', () => {
    it('keeps the saved theme values stable', () => {
        expect(Theme).toEqual({
            DarkTheme: 'DARK_THEME',
            LightTheme: 'LIGHT_THEME',
            SystemTheme: 'SYSTEM_THEME',
            CreamTheme: 'CREAM_THEME',
            MochaTheme: 'MOCHA_THEME',
            NightOwlTheme: 'NIGHT_OWL_THEME',
            BlackOledTheme: 'BLACK_OLED_THEME',
        });
    });

    it('lists each concrete preset with its compatibility mode', () => {
        expect(THEME_PRESETS).toEqual([
            { value: Theme.LightTheme, id: 'light', mode: 'light' },
            { value: Theme.DarkTheme, id: 'dark', mode: 'dark' },
            { value: Theme.CreamTheme, id: 'cream', mode: 'light' },
            { value: Theme.MochaTheme, id: 'mocha', mode: 'dark' },
            { value: 'NIGHT_OWL_THEME', id: 'night-owl', mode: 'dark' },
            { value: 'BLACK_OLED_THEME', id: 'black-oled', mode: 'dark' },
        ]);
    });

    it.each(Object.values(Theme))('preserves the saved value %s', (theme) => {
        expect(normalizeTheme(theme)).toBe(theme);
    });

    it.each([undefined, null, '', 'UNKNOWN_THEME', 1, {}])(
        'normalizes unknown value %p to System',
        (value) => {
            expect(normalizeTheme(value)).toBe(Theme.SystemTheme);
        }
    );

    it.each([
        [Theme.SystemTheme, false, 'light'],
        [Theme.SystemTheme, true, 'dark'],
        ['UNKNOWN_THEME', false, 'light'],
        ['UNKNOWN_THEME', true, 'dark'],
        [Theme.LightTheme, true, 'light'],
        [Theme.DarkTheme, false, 'dark'],
        ['CREAM_THEME', true, 'cream'],
        ['MOCHA_THEME', false, 'mocha'],
        ['NIGHT_OWL_THEME', false, 'night-owl'],
        ['NIGHT_OWL_THEME', true, 'night-owl'],
        ['BLACK_OLED_THEME', false, 'black-oled'],
        ['BLACK_OLED_THEME', true, 'black-oled'],
    ])('resolves %p with system dark %p to %s', (value, systemDark, id) => {
        expect(resolveThemePreset(value, systemDark as boolean).id).toBe(id);
    });

    it('defaults System to the light preset when no OS preference exists', () => {
        expect(resolveThemePreset(Theme.SystemTheme)).toBe(THEME_PRESETS[0]);
    });
});
