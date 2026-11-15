import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map } from 'rxjs';

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

@Injectable({ providedIn: 'root' })
export class SettingsAppVersionService {
    private readonly http = inject(HttpClient);

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
