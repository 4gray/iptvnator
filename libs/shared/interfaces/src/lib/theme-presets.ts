import { Theme } from './theme.enum';

export const THEME_PRESETS = [
    { value: Theme.LightTheme, id: 'light', mode: 'light' },
    { value: Theme.DarkTheme, id: 'dark', mode: 'dark' },
    { value: Theme.CreamTheme, id: 'cream', mode: 'light' },
    { value: Theme.MochaTheme, id: 'mocha', mode: 'dark' },
    { value: Theme.NightOwlTheme, id: 'night-owl', mode: 'dark' },
    { value: Theme.BlackOledTheme, id: 'black-oled', mode: 'dark' },
    { value: Theme.HighContrastTheme, id: 'high-contrast', mode: 'dark' },
] as const;

export interface ThemePreset {
    readonly value: (typeof THEME_PRESETS)[number]['value'];
    readonly id: (typeof THEME_PRESETS)[number]['id'];
    readonly mode: (typeof THEME_PRESETS)[number]['mode'];
}

export function normalizeTheme(value: unknown): Theme {
    return value === Theme.SystemTheme ||
        THEME_PRESETS.some((preset) => preset.value === value)
        ? (value as Theme)
        : Theme.SystemTheme;
}

export function resolveThemePreset(
    value: unknown,
    systemDark = false
): ThemePreset {
    return (
        THEME_PRESETS.find((preset) => preset.value === value) ??
        THEME_PRESETS[systemDark ? 1 : 0]
    );
}

export type ThemeMode = ThemePreset['mode'];

/**
 * The preset "System" shows while the device uses `mode`: a saved preset of
 * that mode, otherwise the original Light or Dark.
 */
export function normalizeSystemTheme(value: unknown, mode: ThemeMode): Theme {
    const preset = THEME_PRESETS.find(
        (candidate) => candidate.value === value && candidate.mode === mode
    );
    if (preset) return preset.value as Theme;
    return mode === 'dark' ? Theme.DarkTheme : Theme.LightTheme;
}
