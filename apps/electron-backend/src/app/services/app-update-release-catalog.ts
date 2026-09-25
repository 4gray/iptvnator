import {
    AppUpdateChannel,
    appUpdateReleasesApiUrl,
    appUpdateReleasesListUrl,
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
 *
 * The list is a snapshot of GitHub at load time and the service keeps it
 * for the whole process, so a release published later is invisible to it
 * until something reloads it — `findIndex` does, once, when a version is
 * missing from a fully paged list (a nightly the updater just offered had
 * "no release notes" for exactly this reason).
 */
export class AppUpdateReleaseCatalog {
    releases: CachedGitHubRelease[] = [];
    loadedReleasePages = 0;
    loadedAllReleases = false;
    private queue: Promise<unknown> = Promise.resolve();

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

    /**
     * Runs `work` after every earlier caller's work has settled. A read
     * computes an index into `releases` and dereferences it after awaiting
     * more pages, and `findIndex` may rebuild the whole list in between,
     * so two overlapping readers of one catalog must never interleave.
     */
    runExclusive<T>(work: () => Promise<T>): Promise<T> {
        const run = this.queue.then(work, work);

        this.queue = run.catch(() => undefined);

        return run;
    }

    /** Forgets every loaded page so the next read starts from GitHub again. */
    reset(): void {
        this.releases = [];
        this.loadedReleasePages = 0;
        this.loadedAllReleases = false;
    }

    /**
     * Index of `version` (or its tag), paging further until it is found.
     * With `reloadOnMiss`, a miss on a completely paged list reloads the
     * list once before answering -1: the snapshot may simply predate the
     * release. Callers that fall back to the newest release on a miss pass
     * false — an unpublished local build would otherwise page the whole
     * list twice for an answer the first pass already had.
     */
    async findIndex(
        version: string | undefined,
        reloadOnMiss = true
    ): Promise<number> {
        if (!version) {
            return -1;
        }

        const normalizedVersion = normalizeVersion(version);
        let reloaded = !reloadOnMiss;

        while (true) {
            const index = this.releases.findIndex(
                (release) =>
                    normalizeVersion(release.version) === normalizedVersion ||
                    normalizeVersion(release.tagName) === normalizedVersion
            );

            if (index !== -1) {
                return index;
            }

            if (this.loadedAllReleases) {
                if (reloaded) {
                    return -1;
                }

                reloaded = true;
                this.reset();
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

        const releasesPageUrl = appUpdateReleasesListUrl(this.channel);

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
