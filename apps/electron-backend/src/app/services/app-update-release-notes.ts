import {
    AppUpdateChannel,
    appVersionChannel,
    buildAppUpdateReleaseNotesNotFoundMessage,
    ElectronBridgeAppUpdateReleaseNotes,
    ElectronBridgeAppUpdateReleaseNotesRequest,
} from '@iptvnator/shared/interfaces';
import {
    AppUpdateReleaseCatalog,
    CachedGitHubRelease,
    ReleaseFetcher,
} from './app-update-release-catalog';

function toReleaseNotes(
    release: CachedGitHubRelease,
    index: number,
    catalog: AppUpdateReleaseCatalog
): ElectronBridgeAppUpdateReleaseNotes {
    return {
        version: release.version,
        tagName: release.tagName,
        releaseName: release.releaseName,
        publishedAt: release.publishedAt,
        bodyMarkdown: release.bodyMarkdown,
        htmlUrl: release.htmlUrl,
        hasNext: index > 0,
        hasPrevious:
            index < catalog.releases.length - 1 || !catalog.loadedAllReleases,
    };
}

/**
 * One lazily created release catalog per channel, plus the two reads the
 * updater performs on them: release notes for a version (with previous /
 * next paging) and the newest release for the manual-install fallback.
 * Every read runs inside the catalog's exclusive queue.
 */
export class AppUpdateReleaseCatalogs {
    private readonly catalogs = new Map<
        AppUpdateChannel,
        AppUpdateReleaseCatalog
    >();

    constructor(
        private readonly fetcher: ReleaseFetcher,
        private readonly userAgent: string
    ) {}

    /**
     * Forgets every loaded catalog. Called when the updater finds a new
     * release: it is newer than anything the catalogs were loaded with, so
     * their snapshots are stale by definition, and forgetting them keeps
     * the "latest" fallback honest (a version lookup reloads on its own).
     */
    clear(): void {
        this.catalogs.clear();
    }

    /** The newest release of `channel`, loading the first page if needed. */
    latestRelease(
        channel: AppUpdateChannel
    ): Promise<CachedGitHubRelease | undefined> {
        const catalog = this.catalogFor(channel);

        return catalog.runExclusive(async () => {
            await catalog.ensureFirstReleaseLoaded();

            return catalog.latest;
        });
    }

    /**
     * Release notes come from the catalog of the channel the requested
     * version belongs to, not the configured one: a nightly build on the
     * stable channel still reads its own notes, and paging from a nightly
     * tag stays inside the nightly list.
     */
    getReleaseNotes(
        configuredChannel: AppUpdateChannel,
        request: ElectronBridgeAppUpdateReleaseNotesRequest
    ): Promise<ElectronBridgeAppUpdateReleaseNotes> {
        const catalog = this.catalogFor(
            request.version
                ? appVersionChannel(request.version)
                : configuredChannel
        );

        return catalog.runExclusive(() =>
            this.readReleaseNotes(catalog, request)
        );
    }

    private catalogFor(channel: AppUpdateChannel): AppUpdateReleaseCatalog {
        let catalog = this.catalogs.get(channel);

        if (!catalog) {
            catalog = new AppUpdateReleaseCatalog(
                channel,
                this.fetcher,
                this.userAgent
            );
            this.catalogs.set(channel, catalog);
        }

        return catalog;
    }

    /** The exclusive section of `getReleaseNotes`: one reader per catalog. */
    private async readReleaseNotes(
        catalog: AppUpdateReleaseCatalog,
        request: ElectronBridgeAppUpdateReleaseNotesRequest
    ): Promise<ElectronBridgeAppUpdateReleaseNotes> {
        const canFallbackToLatest =
            !request.direction &&
            (!request.version || request.fallbackToLatest);

        if (canFallbackToLatest) {
            await catalog.ensureFirstReleaseLoaded();
        } else {
            await catalog.ensurePageLoaded(1);
        }

        let index = await catalog.findIndex(request.version);

        if (index === -1 && canFallbackToLatest) {
            index = 0;
        }

        if (index === -1) {
            throw new Error(
                buildAppUpdateReleaseNotesNotFoundMessage(request.version)
            );
        }

        if (request.direction === 'previous') {
            index += 1;
            while (
                index >= catalog.releases.length &&
                !catalog.loadedAllReleases
            ) {
                await catalog.ensurePageLoaded(catalog.loadedReleasePages + 1);
            }
        } else if (request.direction === 'next') {
            index -= 1;
        }

        const release = catalog.releases[index];

        if (!release) {
            throw new Error('No release notes are available in that direction');
        }

        return toReleaseNotes(release, index, catalog);
    }
}
