import {
    AppUpdateChannel,
    appUpdateReleasesApiUrl,
    appUpdateReleasesPageUrl,
    appVersionChannel,
} from '@iptvnator/shared/interfaces';

const GITHUB_RELEASES_PER_PAGE = 10;

interface GitHubReleaseResponse {
    body?: string | null;
    draft?: boolean;
    html_url?: string;
    name?: string | null;
    prerelease?: boolean;
    published_at?: string | null;
    tag_name?: string;
}

export interface CachedGitHubRelease {
    bodyMarkdown: string;
    draft: boolean;
    htmlUrl: string;
    prerelease: boolean;
    publishedAt?: string | null;
    releaseName?: string | null;
    tagName: string;
    version: string;
}

export interface ReleaseFetchResponse {
    json(): Promise<unknown>;
    ok: boolean;
    status: number;
    statusText: string;
}

export type ReleaseFetcher = (
    url: string,
    init?: { headers?: Record<string, string> }
) => Promise<ReleaseFetchResponse>;

export function normalizeVersion(value: string | null | undefined): string {
    return (value ?? '').trim().replace(/^v/i, '');
}

function isGitHubRelease(value: unknown): value is GitHubReleaseResponse {
    return Boolean(
        value &&
        typeof value === 'object' &&
        'tag_name' in value &&
        typeof (value as GitHubReleaseResponse).tag_name === 'string'
    );
}

/**
 * Lazily paged, newest-first list of one channel's published GitHub
 * releases. Drafts are never listed. The stable catalog also drops
 * prereleases (a beta tag must not become "the latest version"), while the
 * nightly catalog keeps only releases whose version carries the nightly
 * identifier, so a stray tag in that repository cannot be offered either.
 */
export class AppUpdateReleaseCatalog {
    readonly releases: CachedGitHubRelease[] = [];
    loadedReleasePages = 0;
    loadedAllReleases = false;

    constructor(
        readonly channel: AppUpdateChannel,
        private readonly fetcher: ReleaseFetcher,
        private readonly userAgent: string
    ) {}

    get latest(): CachedGitHubRelease | undefined {
        return this.releases[0];
    }

    async ensureFirstReleaseLoaded(): Promise<void> {
        while (!this.loadedAllReleases && this.releases.length === 0) {
            await this.ensurePageLoaded(this.loadedReleasePages + 1);
        }
    }

    async ensurePageLoaded(page: number): Promise<void> {
        while (!this.loadedAllReleases && this.loadedReleasePages < page) {
            await this.loadPage(this.loadedReleasePages + 1);
        }
    }

    /** Index of `version` (or its tag), paging further until it is found. */
    async findIndex(version: string | undefined): Promise<number> {
        if (!version) {
            return -1;
        }

        const normalizedVersion = normalizeVersion(version);

        while (true) {
            const index = this.releases.findIndex(
                (release) =>
                    normalizeVersion(release.version) === normalizedVersion ||
                    normalizeVersion(release.tagName) === normalizedVersion
            );

            if (index !== -1 || this.loadedAllReleases) {
                return index;
            }

            await this.ensurePageLoaded(this.loadedReleasePages + 1);
        }
    }

    private belongsToChannel(release: GitHubReleaseResponse): boolean {
        if (release.draft) {
            return false;
        }

        if (this.channel === 'nightly') {
            return appVersionChannel(release.tag_name) === 'nightly';
        }

        return !release.prerelease;
    }

    private async loadPage(page: number): Promise<void> {
        const url = `${appUpdateReleasesApiUrl(this.channel)}?per_page=${GITHUB_RELEASES_PER_PAGE}&page=${page}`;
        const response = await this.fetcher(url, {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': this.userAgent,
            },
        });

        if (!response.ok) {
            throw new Error(
                `GitHub releases request failed: ${response.status} ${response.statusText}`
            );
        }

        const payload = await response.json();

        if (!Array.isArray(payload)) {
            throw new Error('GitHub releases response was not an array');
        }

        const releasesPageUrl = appUpdateReleasesPageUrl(this.channel).replace(
            /\/latest$/,
            ''
        );

        for (const release of payload) {
            if (!isGitHubRelease(release) || !this.belongsToChannel(release)) {
                continue;
            }

            const tagName = release.tag_name;

            if (this.releases.some((cached) => cached.tagName === tagName)) {
                continue;
            }

            this.releases.push({
                bodyMarkdown: release.body ?? '',
                draft: Boolean(release.draft),
                htmlUrl:
                    release.html_url ?? `${releasesPageUrl}/tag/${tagName}`,
                prerelease: Boolean(release.prerelease),
                publishedAt: release.published_at,
                releaseName: release.name ?? tagName,
                tagName,
                version: normalizeVersion(tagName),
            });
        }

        this.loadedReleasePages = page;
        this.loadedAllReleases = payload.length < GITHUB_RELEASES_PER_PAGE;
    }
}
