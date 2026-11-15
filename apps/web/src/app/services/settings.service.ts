import { inject, Injectable, signal } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Observable } from 'rxjs';
import {
    normalizeSystemTheme,
    normalizeTheme,
    normalizeThemeAccent,
    resolveThemeAccentHex,
    resolveThemePreset,
    STORE_KEY,
    Theme,
    ThemeAccent,
    ThemePreset,
} from '@iptvnator/shared/interfaces';

type LegacyMediaQueryList = MediaQueryList & {
    addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

@Injectable({
    providedIn: 'root',
})
export class SettingsService {
    private storage = inject(StorageMap);
    private readonly systemThemeMediaQuery =
        typeof window !== 'undefined' && 'matchMedia' in window
            ? window.matchMedia('(prefers-color-scheme: dark)')
            : null;
    private readonly systemThemeChangeHandler = (
        event: MediaQueryListEvent
    ): void => {
        this.applyResolvedTheme(this.resolveSystemTheme(event.matches));
    };
    private isSystemThemeSyncActive = false;
    private isSystemThemeSelected = false;
    private systemThemes = {
        light: Theme.LightTheme as Theme,
        dark: Theme.DarkTheme as Theme,
    };
    private accent: ThemeAccent | null = null;
    private accentTokens?: typeof import('./theme-accent-tokens');

    /** The preset on screen; "System" resolves to light or dark. */
    readonly appliedThemePresetId = signal<ThemePreset['id']>('light');

    /**
     * Changes the visual theme of the application
     * @param selectedTheme theme to set
     */
    changeTheme(selectedTheme: Theme): void {
        this.stopSystemThemeSync();

        const theme = normalizeTheme(selectedTheme);
        this.isSystemThemeSelected = theme === Theme.SystemTheme;
        if (theme === Theme.SystemTheme) {
            this.startSystemThemeSync();
            this.applyResolvedTheme(
                this.resolveSystemTheme(!!this.systemThemeMediaQuery?.matches)
            );
            return;
        }

        this.applyResolvedTheme(theme);
    }

    /**
     * The presets "System" shows while the device is light or dark. Applies
     * at once when System is the active theme.
     */
    changeSystemThemes(light: unknown, dark: unknown): void {
        this.systemThemes = {
            light: normalizeSystemTheme(light, 'light'),
            dark: normalizeSystemTheme(dark, 'dark'),
        };
        if (this.isSystemThemeSelected) {
            this.applyResolvedTheme(
                this.resolveSystemTheme(!!this.systemThemeMediaQuery?.matches)
            );
        }
    }

    private resolveSystemTheme(deviceIsDark: boolean): Theme {
        return deviceIsDark ? this.systemThemes.dark : this.systemThemes.light;
    }

    /**
     * Lays an accent colour over whichever theme is active (and over the
     * themes applied later); `null` restores the theme's own colour.
     */
    changeThemeAccent(accent: unknown): Promise<void> {
        this.accent = normalizeThemeAccent(accent);
        return this.applyThemeAccent();
    }

    private applyResolvedTheme(selectedTheme: Theme): void {
        const preset = resolveThemePreset(selectedTheme);
        const body = document.body;
        body.dataset['appTheme'] = preset.id;
        // Shared component styles, including the resize handles, use an
        // explicit .light-theme selector for their light-mode overrides.
        if (preset.mode === 'dark') {
            body.classList.add('dark-theme');
            body.classList.remove('light-theme');
        } else {
            body.classList.remove('dark-theme');
            body.classList.add('light-theme');
        }
        this.appliedThemePresetId.set(preset.id);
        // The accent's lightness depends on the new theme's surfaces.
        void this.applyThemeAccent();
    }

    /**
     * Overrides the selection and Material primary roles on `body`, where
     * `m3-theme.scss` declares the app and Material tokens that read them.
     */
    private async applyThemeAccent(): Promise<void> {
        if (this.accent && !this.accentTokens) {
            try {
                this.accentTokens = await import('./theme-accent-tokens');
            } catch {
                console.warn('Theme accent colors could not be loaded');
                return;
            }
        }
        if (!this.accentTokens) return;

        // Read the current selection and surfaces after the chunk arrives.
        const {
            deriveThemeAccentTokens,
            readThemeAccentSurfaces,
            THEME_ACCENT_TOKEN_NAMES,
        } = this.accentTokens;
        const body = document.body;
        for (const token of THEME_ACCENT_TOKEN_NAMES) {
            body.style.removeProperty(token);
        }
        const hex = resolveThemeAccentHex(this.accent);
        const surfaces = hex
            ? readThemeAccentSurfaces(getComputedStyle(body))
            : null;
        if (!hex || !surfaces || !this.accent) {
            delete body.dataset['themeAccent'];
            return;
        }

        body.dataset['themeAccent'] = this.accent;
        const tokens = deriveThemeAccentTokens(hex, surfaces);
        for (const [token, value] of Object.entries(tokens)) {
            body.style.setProperty(token, value);
        }
    }

    private startSystemThemeSync(): void {
        if (!this.systemThemeMediaQuery || this.isSystemThemeSyncActive) {
            return;
        }

        const mediaQuery = this.systemThemeMediaQuery as LegacyMediaQueryList;

        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener(
                'change',
                this.systemThemeChangeHandler
            );
        } else {
            mediaQuery.addListener?.(this.systemThemeChangeHandler);
        }

        this.isSystemThemeSyncActive = true;
    }

    private stopSystemThemeSync(): void {
        if (!this.systemThemeMediaQuery || !this.isSystemThemeSyncActive) {
            return;
        }

        const mediaQuery = this.systemThemeMediaQuery as LegacyMediaQueryList;

        if (mediaQuery.removeEventListener) {
            mediaQuery.removeEventListener(
                'change',
                this.systemThemeChangeHandler
            );
        } else {
            mediaQuery.removeListener?.(this.systemThemeChangeHandler);
        }

        this.isSystemThemeSyncActive = false;
    }

    /**
     * Returns the value of the given key from the local storage
     * @param key key to get
     * @returns returns the value of the given key
     */
    getValueFromLocalStorage<T = unknown>(key: STORE_KEY): Observable<T> {
        return this.storage.get(key) as Observable<T>;
    }

    /**
     * Sets the given key/value pair in the local storage
     * @param key key to set
     * @param value value to set
     * @param withCallback if true, the callback will be called after the value is set
     */
    setValueToLocalStorage(
        key: STORE_KEY,
        value: unknown,
        withCallback = false
    ): Observable<unknown> | void {
        if (withCallback) {
            return this.storage.set(key, value);
        }

        this.storage.set(key, value).subscribe();
    }
}
