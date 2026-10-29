export interface TvBuildInfo {
    name: string;
    version: string;
    buildId: string;
    buildTimestamp: string;
    gitCommit: string;
}

declare const __TV_BUILD_INFO__: TvBuildInfo | undefined;

export const tvBuildInfo: TvBuildInfo =
    typeof __TV_BUILD_INFO__ === 'undefined'
        ? {
              name: 'unknown',
              version: 'unknown',
              buildId: 'unknown',
              buildTimestamp: 'unknown',
              gitCommit: 'unknown',
          }
        : __TV_BUILD_INFO__;

export const tvDeveloperInfo = {
    name: 'Harsh Tiwar',
    email: 'harsh.tiwar9@gmail.com',
    website: 'https://harshtiwar9.github.io/Resume/',
    support: 'mailto:harsh.tiwar9@gmail.com',
} as const;

export const tvLicenceInfo = {
    licence: 'MIT License',
    copyright: 'Copyright (c) 2019-2026 4gray',
    projectTrademark: 'IPTVnator name and logo are protected by the project trademark notice.',
} as const;

export function formatBuildTimestamp(value: string): string {
    if (!value || value === 'unknown') return 'unknown';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'unknown';
    return `${date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`;
}

export function detectTvPlatform(
    userAgent: string,
    palmSystemPresent: boolean
): { platform: string; runtime: string } {
    const webOS = palmSystemPresent || /webos|lgtv|netcast/i.test(userAgent);
    return webOS
        ? {
              platform: 'LG webOS TV',
              runtime: 'Chromium-compatible webOS runtime',
          }
        : {
              platform: 'Browser runtime',
              runtime: 'Browser / Chromium-compatible runtime',
          };
}
