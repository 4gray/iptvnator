import {
    normalizeSystemTheme,
    normalizeThemeAccent,
    Theme,
    ThemeAccent,
} from '@iptvnator/shared/interfaces';
import type { SettingsService } from '../services/settings.service';

/** Saved settings or the form's value, whose controls may hold `null`. */
interface AppearanceValues {
    theme?: Theme | null;
    themeAccent?: ThemeAccent | null;
    systemLightTheme?: Theme | null;
    systemDarkTheme?: Theme | null;
}
type AppearanceService = Pick<
    SettingsService,
    'changeTheme' | 'changeThemeAccent' | 'changeSystemThemes'
>;

/** Shows the presets System uses for a light and a dark device. */
export function previewSystemThemes(
    service: AppearanceService,
    value: AppearanceValues
): void {
    service.changeSystemThemes(value.systemLightTheme, value.systemDarkTheme);
}

/**
 * Re-applies the saved appearance after Save or Discard. Appearance choices
 * preview immediately, so one changed again while Save ran keeps its newer
 * preview. The pair goes first: System resolves through it.
 */
export function restoreSavedAppearance(
    service: AppearanceService,
    draft: AppearanceValues,
    saved: AppearanceValues
): void {
    if (
        draft.systemLightTheme === saved.systemLightTheme &&
        draft.systemDarkTheme === saved.systemDarkTheme
    ) {
        previewSystemThemes(service, saved);
    }
    if (draft.theme === saved.theme) {
        service.changeTheme(saved.theme ?? Theme.SystemTheme);
    }
    const savedAccent = saved.themeAccent ?? null;
    if ((draft.themeAccent ?? null) === savedAccent) {
        void service.changeThemeAccent(savedAccent);
    }
}

/** Appearance values for the form; settings saved earlier may lack them. */
export function normalizeSavedAppearance(settings: AppearanceValues) {
    return {
        themeAccent: normalizeThemeAccent(settings.themeAccent),
        systemLightTheme: normalizeSystemTheme(
            settings.systemLightTheme,
            'light'
        ),
        systemDarkTheme: normalizeSystemTheme(settings.systemDarkTheme, 'dark'),
    };
}
