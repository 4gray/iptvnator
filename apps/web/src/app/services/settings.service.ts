import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { catchError, map, Observable } from 'rxjs';
import {
    normalizeTheme,
    normalizeThemeAccent,
    resolveThemeAccentHex,
    resolveThemePreset,
    STORE_KEY,
    Theme,
    ThemeAccent,
    ThemePreset,
} from '@iptvnator/shared/interfaces';
import {
    deriveThemeAccentTokens,
    readThemeAccentSurfaces,
    THEME_ACCENT_TOKEN_NAMES,
} from './theme-accent-tokens';

const PRERELEASE_KEYWORDS = [
    'beta',
    'alpha',
    'rc',
    'preview',
    'dev',
    'canary',
    'nightly',
] as const;

interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease: boolean;
}

type LegacyMediaQueryList = MediaQueryList & {
    addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

function parseVersion(input: string): ParsedVersion | null {
    const normalized = input.trim().replace(/^v/i, '');
    const match = normalized.match(
        /(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+]?([0-9A-Za-z.-]+))?/
    );

    if (!match) {
        return null;
    }

    return {
        major: Number(match[1] ?? 0),
        minor: Number(match[2] ?? 0),
        patch: Number(match[3] ?? 0),
        prerelease: Boolean(match[4]),
    };
}

function hasPrereleaseKeyword(value: string): boolean {
    const normalized = value.toLowerCase();
    return PRERELEASE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
    if (a.major !== b.major) {
        return a.major - b.major;
    }
    if (a.minor !== b.minor) {
        return a.minor - b.minor;
    }
    return a.patch - b.patch;
}

@Injectable({
    providedIn: 'root',
})
export class SettingsService {
    private http = inject(HttpClient);
    private storage = inject(StorageMap);
    private readonly systemThemeMediaQuery =
        typeof window !== 'undefined' && 'matchMedia' in window
            ? window.matchMedia('(prefers-color-scheme: dark)')
            : null;
    private readonly systemThemeChangeHandler = (
        event: MediaQueryListEvent
    ): void => {
        this.applyResolvedTheme(
            event.matches ? Theme.DarkTheme : Theme.LightTheme
        );
    };
    private isSystemThemeSyncActive = false;
    private accent: ThemeAccent | null = null;

    /** The preset on screen; "System" resolves to light or dark. */
    readonly appliedThemePresetId = signal<ThemePreset['id']>('light');

    /**
     * Changes the visual theme of the application
     * @param selectedTheme theme to set
     */
    changeTheme(selectedTheme: Theme): void {
        this.stopSystemThemeSync();

        const theme = normalizeTheme(selectedTheme);
        if (theme === Theme.SystemTheme) {
            this.startSystemThemeSync();
            this.applyResolvedTheme(
                this.systemThemeMediaQuery?.matches
                    ? Theme.DarkTheme
                    : Theme.LightTheme
            );
            return;
        }

        this.applyResolvedTheme(theme);
    }

    /**
     * Lays an accent colour over whichever theme is active (and over the
     * themes applied later); `null` restores the theme's own colour.
     */
    changeThemeAccent(accent: unknown): void {
        this.accent = normalizeThemeAccent(accent);
        this.applyThemeAccent();
    }

    /** The colour `accent` takes on the theme on screen, for previews. */
    previewThemeAccentColor(accent: unknown): string | null {
        const hex = resolveThemeAccentHex(accent);
        const surfaces = hex
            ? readThemeAccentSurfaces(getComputedStyle(document.body))
            : null;
        if (!hex || !surfaces) return hex;
        return (
            deriveThemeAccentTokens(hex, surfaces)['--app-selection-color'] ??
            hex
        );
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
        this.applyThemeAccent();
    }

    /**
     * Overrides the selection and Material primary roles on `body`, where
     * every theme declares the tokens derived from them. The
     * `data-theme-accent` attribute makes `m3-theme.scss` re-declare the
     * Material component tokens there too, so they read these values.
     */
    private applyThemeAccent(): void {
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

    /**
     * Returns the version of the released app
     * Filters out pre-release versions (beta, alpha, rc)
     */
    getAppVersion() {
        return this.http
            .get<
                { created_at: string; name: string }[]
            >('https://api.github.com/repos/4gray/iptvnator/releases')
            .pipe(
                map((response) => {
                    // Filter out pre-release versions (beta, alpha, rc, etc.)
                    const stableReleases = response.filter((release) => {
                        if (hasPrereleaseKeyword(release.name)) {
                            return false;
                        }

                        const version = parseVersion(release.name);
                        if (!version) return false;

                        return !version.prerelease;
                    });

                    // Sort stable releases by creation date
                    const sortedReleases = stableReleases.sort(
                        (a, b) =>
                            new Date(b.created_at).getTime() -
                            new Date(a.created_at).getTime()
                    );

                    return sortedReleases[0];
                }),
                map((response) => response.name),
                catchError((err) => {
                    console.error(err);
                    throw new Error(err);
                })
            );
    }

    /**
     * Compares current version with latest version
     * @param currentVersion current version of the app
     * @param latestVersion latest stable version from GitHub
     * @returns true if current version is outdated
     */
    isVersionOutdated(currentVersion: string, latestVersion: string): boolean {
        const cleanCurrent = parseVersion(currentVersion);
        const cleanLatest = parseVersion(latestVersion);

        if (!cleanCurrent || !cleanLatest) {
            console.warn('Invalid version format:', {
                currentVersion,
                latestVersion,
            });
            return false;
        }

        return compareVersions(cleanCurrent, cleanLatest) < 0;
    }
}
