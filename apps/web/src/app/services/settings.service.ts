import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { catchError, map, Observable } from 'rxjs';
import * as semver from 'semver';
import { STORE_KEY, Theme } from 'shared-interfaces';

@Injectable({
    providedIn: 'root',
})
export class SettingsService {
    private http = inject(HttpClient);
    private storage = inject(StorageMap);

    /**
     * Changes the visual theme of the application
     * @param selectedTheme theme to set
     */
    changeTheme(selectedTheme: Theme): void {
        if (selectedTheme === Theme.LightTheme) {
            document.body.classList.remove('dark-theme');
        } else if (selectedTheme === Theme.DarkTheme) {
            document.body.classList.add('dark-theme');
        }
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
    ): Observable<unknown> | never {
        if (withCallback) {
            return this.storage.set(key, value);
        } else {
            this.storage.set(key, value).subscribe(() => {});
        }
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
                        const releaseName = release.name.toLowerCase();

                        // Check for beta/alpha/rc keywords in the release name
                        const prereleaseKeywords = [
                            'beta',
                            'alpha',
                            'rc',
                            'preview',
                            'dev',
                            'canary',
                            'nightly',
                        ];
                        const hasPrereleaseKeyword = prereleaseKeywords.some(
                            (keyword) => releaseName.includes(keyword)
                        );

                        if (hasPrereleaseKeyword) {
                            return false;
                        }

                        // Validate version format
                        const version = semver.valid(
                            semver.coerce(release.name)
                        );
                        if (!version) return false;

                        // Check if version has prerelease tags in semver format
                        return !semver.prerelease(release.name);
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
        // Clean and coerce versions to handle invalid formats
        const cleanCurrent = semver.coerce(currentVersion);
        const cleanLatest = semver.coerce(latestVersion);

        if (!cleanCurrent || !cleanLatest) {
            console.warn('Invalid version format:', {
                currentVersion,
                latestVersion,
            });
            return false;
        }

        return semver.lt(cleanCurrent, cleanLatest);
    }
}
