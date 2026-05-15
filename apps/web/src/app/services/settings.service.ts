import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { catchError, map, Observable } from 'rxjs';
import { STORE_KEY, Theme } from '@iptvnator/shared/interfaces';

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

    /**
     * Changes the visual theme of the application
     * @param selectedTheme theme to set
     */
    changeTheme(selectedTheme: Theme): void {
        this.stopSystemThemeSync();

        if (selectedTheme === Theme.SystemTheme) {
            this.startSystemThemeSync();
            this.applyResolvedTheme(
                this.systemThemeMediaQuery?.matches
                    ? Theme.DarkTheme
                    : Theme.LightTheme
            );
            return;
        }

        this.applyResolvedTheme(selectedTheme);
    }

    private applyResolvedTheme(selectedTheme: Theme): void {
        if (selectedTheme === Theme.DarkTheme) {
            document.body.classList.add('dark-theme');
            return;
        }

        document.body.classList.remove('dark-theme');
    }

    private startSystemThemeSync(): void {
        if (!this.systemThemeMediaQuery || this.isSystemThemeSyncActive) {
            return;
        }

        const mediaQuery = this.systemThemeMediaQuery as LegacyMediaQueryList;

        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', this.systemThemeChangeHandler);
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
    getValueFromLocalStorage(key: STORE_KEY) {
        return this.storage.get(key);
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
            .get<{ created_at: string; name: string }[]>(
                'https://api.github.com/repos/4gray/iptvnator/releases'
            )
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
    isVersionOutdated(
        currentVersion: string,
        latestVersion: string
    ): boolean {
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
