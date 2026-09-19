import { EventEmitter } from 'events';
import {
    AppUpdateChannel,
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { AppUpdateReleaseCatalog } from './app-update-release-catalog';
import { AppUpdateService } from './app-update.service';

class FakeUpdater extends EventEmitter {
    autoDownload = true;
    autoInstallOnAppQuit = true;
    // electron-updater turns these on by itself for prerelease builds and
    // channel assignments; the service must reset them explicitly.
    allowPrerelease = true;
    allowDowngrade = true;
    channel: string | null = null;
    setFeedURL = jest.fn();
    checkForUpdates = jest.fn().mockResolvedValue(null);
    downloadUpdate = jest.fn().mockResolvedValue([]);
    quitAndInstall = jest.fn();
}

const nightlyReleases = [
    {
        body: '## Nightly\n\nNewest master build\n\n<!-- iptvnator-commit: abc -->',
        draft: false,
        html_url:
            'https://github.com/4gray/iptvnator-nightly/releases/tag/v0.23.1-nightly.20260915.7',
        name: 'Nightly 0.23.1-nightly.20260915.7',
        prerelease: true,
        published_at: '2026-09-15T00:00:00.000Z',
        tag_name: 'v0.23.1-nightly.20260915.7',
    },
    {
        body: 'not a nightly',
        draft: false,
        html_url:
            'https://github.com/4gray/iptvnator-nightly/releases/tag/v9.9.9',
        name: 'stray tag',
        prerelease: false,
        published_at: '2026-09-14T12:00:00.000Z',
        tag_name: 'v9.9.9',
    },
    {
        body: '## Nightly\n\nOlder master build',
        draft: false,
        html_url:
            'https://github.com/4gray/iptvnator-nightly/releases/tag/v0.23.1-nightly.20260914.5',
        name: 'Nightly 0.23.1-nightly.20260914.5',
        prerelease: true,
        published_at: '2026-09-14T00:00:00.000Z',
        tag_name: 'v0.23.1-nightly.20260914.5',
    },
];

/** Answers the stable and nightly repositories with their own lists. */
function createChannelReleaseFetcher() {
    return jest.fn(async (url: string) => {
        const releases = url.includes('/iptvnator-nightly/')
            ? nightlyReleases
            : githubReleases;

        return {
            json: jest.fn().mockResolvedValue(releases),
            ok: true,
            status: 200,
            statusText: 'OK',
        };
    });
}

const githubReleases = [
    {
        body: '## New\n\nFresh build',
        draft: false,
        html_url: 'https://github.com/4gray/iptvnator/releases/tag/v0.24.0',
        name: 'v0.24.0',
        prerelease: false,
        published_at: '2026-06-29T00:00:00.000Z',
        tag_name: 'v0.24.0',
    },
    {
        body: '## Current\n\nUpdate details',
        draft: false,
        html_url: 'https://github.com/4gray/iptvnator/releases/tag/v0.23.0',
        name: 'v0.23.0',
        prerelease: false,
        published_at: '2026-06-28T00:00:00.000Z',
        tag_name: 'v0.23.0',
    },
    {
        body: 'beta notes',
        draft: false,
        html_url:
            'https://github.com/4gray/iptvnator/releases/tag/v0.22.5-beta',
        name: 'v0.22.5-beta',
        prerelease: true,
        published_at: '2026-06-27T00:00:00.000Z',
        tag_name: 'v0.22.5-beta',
    },
    {
        body: '## Older\n\nBug fixes',
        draft: false,
        html_url: 'https://github.com/4gray/iptvnator/releases/tag/v0.22.0',
        name: 'v0.22.0',
        prerelease: false,
        published_at: '2026-06-20T00:00:00.000Z',
        tag_name: 'v0.22.0',
    },
];

function createReleaseFetcher(pages: unknown[][] = [githubReleases]) {
    return jest.fn(async (url: string) => {
        const parsedUrl = new URL(url);
        const page = Number(parsedUrl.searchParams.get('page') ?? '1');

        return {
            json: jest.fn().mockResolvedValue(pages[page - 1] ?? []),
            ok: true,
            status: 200,
            statusText: 'OK',
        };
    });
}

function createWindow() {
    return {
        isDestroyed: jest.fn(() => false),
        webContents: {
            send: jest.fn(),
        },
    };
}

function createService(
    overrides: {
        fetcher?: ReturnType<typeof createReleaseFetcher>;
        isPackaged?: boolean;
        platform?: NodeJS.Platform;
        env?: NodeJS.ProcessEnv;
        prepareQuit?: () => void;
        cancelPreparedQuit?: () => void;
        channel?: AppUpdateChannel;
        appVersion?: string;
    } = {}
) {
    const updater = new FakeUpdater();
    const win = createWindow();
    const service = new AppUpdateService({
        app: {
            getVersion: () => '0.22.0',
            isPackaged: overrides.isPackaged ?? true,
        },
        appVersion: overrides.appVersion,
        channel: overrides.channel,
        getMainWindow: () => win,
        cancelPreparedQuit: overrides.cancelPreparedQuit,
        platform: overrides.platform ?? 'darwin',
        prepareQuit: overrides.prepareQuit,
        processEnv: overrides.env ?? {},
        releaseFetcher: overrides.fetcher,
        updater,
    });

    return { service, updater, win };
}

describe('AppUpdateService', () => {
    it('reports unsupported status outside packaged builds', () => {
        const { service, updater } = createService({ isPackaged: false });

        expect(service.getStatus()).toEqual({
            currentVersion: '0.22.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Unsupported,
            supportedSelfUpdate: false,
            channel: 'stable',
            installedChannel: 'stable',
        });
        expect(updater.autoDownload).toBe(true);
    });

    it('does not resolve the updater adapter outside self-update builds', async () => {
        const updaterFactory = jest.fn(() => new FakeUpdater());
        const service = new AppUpdateService({
            app: {
                getVersion: () => '0.0',
                isPackaged: false,
            },
            getMainWindow: () => createWindow(),
            updater: updaterFactory,
        });

        expect(service.getStatus()).toEqual({
            currentVersion: '0.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Unsupported,
            supportedSelfUpdate: false,
            channel: 'stable',
            installedChannel: 'stable',
        });

        await service.checkForUpdatesOnStartup();

        expect(updaterFactory).not.toHaveBeenCalled();
    });

    it('uses the build app version instead of the Electron runtime version', () => {
        const service = new AppUpdateService({
            app: {
                getVersion: () => '41.7.2',
                isPackaged: false,
            },
            appVersion: '0.22.0',
            getMainWindow: () => createWindow(),
            updater: jest.fn(() => new FakeUpdater()),
        });

        expect(service.getStatus()).toEqual({
            currentVersion: '0.22.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Unsupported,
            supportedSelfUpdate: false,
            channel: 'stable',
            installedChannel: 'stable',
        });
    });

    it('checks GitHub releases without resolving the updater on unsupported packaged Linux builds', async () => {
        const fetcher = createReleaseFetcher();
        const updaterFactory = jest.fn(() => new FakeUpdater());
        const service = new AppUpdateService({
            app: {
                getVersion: () => '0.22.0',
                isPackaged: true,
            },
            getMainWindow: () => createWindow(),
            platform: 'linux',
            processEnv: {},
            releaseFetcher: fetcher,
            updater: updaterFactory,
        });

        await service.checkForUpdates();

        expect(updaterFactory).not.toHaveBeenCalled();
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.github.com/repos/4gray/iptvnator/releases?per_page=10&page=1',
            expect.any(Object)
        );
        expect(service.getStatus()).toEqual(
            expect.objectContaining({
                latestVersion: '0.24.0',
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available,
                supportedSelfUpdate: false,
            })
        );
    });

    it('supports Linux self-update only for AppImage builds', () => {
        const unsupported = createService({
            platform: 'linux',
            env: {},
        }).service.getStatus();
        const appImage = createService({
            platform: 'linux',
            env: { APPIMAGE: '/Applications/IPTVnator.AppImage' },
        }).service.getStatus();

        expect(unsupported.supportedSelfUpdate).toBe(false);
        expect(unsupported.status).toBe(
            ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Unsupported
        );
        expect(appImage.supportedSelfUpdate).toBe(true);
        expect(appImage.status).toBe(ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Idle);
    });

    it('checks for updates without downloading automatically', async () => {
        const { service, updater } = createService();

        await service.checkForUpdates();

        expect(updater.autoDownload).toBe(false);
        expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
        expect(service.getStatus().status).toBe(
            ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Checking
        );
    });

    it('deduplicates concurrent update checks', async () => {
        const { service, updater } = createService();
        let resolveCheck: ((value: unknown) => void) | undefined;
        updater.checkForUpdates.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveCheck = resolve;
                })
        );

        const firstCheck = service.checkForUpdates();
        const secondCheck = service.checkForUpdates();

        expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
        expect(service.getStatus().status).toBe(
            ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Checking
        );

        resolveCheck?.(null);
        await expect(Promise.all([firstCheck, secondCheck])).resolves.toEqual([
            service.getStatus(),
            service.getStatus(),
        ]);

        await service.checkForUpdates();

        expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    });

    it('checks packaged non-AppImage Linux builds through GitHub manual fallback', async () => {
        const fetcher = createReleaseFetcher();
        const { service, updater } = createService({
            env: {},
            fetcher,
            platform: 'linux',
        });

        await service.checkForUpdates();

        expect(updater.checkForUpdates).not.toHaveBeenCalled();
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.github.com/repos/4gray/iptvnator/releases?per_page=10&page=1',
            expect.objectContaining({
                headers: expect.objectContaining({
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'iptvnator/0.22.0',
                }),
            })
        );
        expect(service.getStatus()).toMatchObject({
            latestVersion: '0.24.0',
            release: {
                releaseName: 'v0.24.0',
                version: '0.24.0',
            },
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available,
            supportedSelfUpdate: false,
            channel: 'stable',
            installedChannel: 'stable',
        });
    });

    it('loads additional GitHub release pages when the first page has no stable releases', async () => {
        const prereleasePage = Array.from({ length: 10 }, (_, index) => ({
            ...githubReleases[2],
            name: `v0.25.${index}-beta`,
            tag_name: `v0.25.${index}-beta`,
        }));
        const fetcher = createReleaseFetcher([
            prereleasePage,
            [githubReleases[0]],
        ]);
        const { service } = createService({
            env: {},
            fetcher,
            platform: 'linux',
        });

        await service.checkForUpdates();

        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(
            fetcher.mock.calls.map(([url]) =>
                new URL(url).searchParams.get('page')
            )
        ).toEqual(['1', '2']);
        expect(service.getStatus()).toMatchObject({
            latestVersion: '0.24.0',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available,
            supportedSelfUpdate: false,
            channel: 'stable',
            installedChannel: 'stable',
        });
    });

    it('starts a packaged startup check without downloading automatically', async () => {
        const { service, updater } = createService();

        await service.checkForUpdatesOnStartup();

        expect(updater.autoDownload).toBe(false);
        expect(updater.downloadUpdate).not.toHaveBeenCalled();
        expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    });

    it('loads release notes lazily and navigates between cached versions', async () => {
        const fetcher = createReleaseFetcher();
        const { service } = createService({ fetcher });

        const current = await service.getReleaseNotes({ version: '0.23.0' });
        const older = await service.getReleaseNotes({
            direction: 'previous',
            version: current.tagName,
        });
        const newer = await service.getReleaseNotes({
            direction: 'next',
            version: older.tagName,
        });

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(current).toMatchObject({
            bodyMarkdown: '## Current\n\nUpdate details',
            hasNext: true,
            hasPrevious: true,
            tagName: 'v0.23.0',
            version: '0.23.0',
        });
        expect(older).toMatchObject({
            bodyMarkdown: '## Older\n\nBug fixes',
            hasNext: true,
            hasPrevious: false,
            tagName: 'v0.22.0',
        });
        expect(newer.tagName).toBe('v0.23.0');
    });

    it('falls back to latest stable release notes when a local dev version is unpublished', async () => {
        const fetcher = createReleaseFetcher();
        const { service } = createService({ fetcher, isPackaged: false });

        await expect(
            service.getReleaseNotes({
                fallbackToLatest: true,
                version: '0.25.0',
            })
        ).resolves.toMatchObject({
            bodyMarkdown: '## New\n\nFresh build',
            tagName: 'v0.24.0',
            version: '0.24.0',
        });
    });

    it('stores available release details from updater events', () => {
        const { service } = createService();

        service.handleUpdateAvailable({
            version: '0.23.0',
            releaseName: 'Release v0.23.0',
            releaseDate: '2026-06-28T10:00:00.000Z',
            releaseNotes: 'Bug fixes',
        });

        expect(service.getStatus()).toMatchObject({
            latestVersion: '0.23.0',
            release: {
                releaseDate: '2026-06-28T10:00:00.000Z',
                releaseName: 'Release v0.23.0',
                releaseNotes: 'Bug fixes',
                version: '0.23.0',
            },
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available,
        });
    });

    it('downloads only after an update is available and exposes progress', async () => {
        const { service, updater } = createService();
        service.handleUpdateAvailable({ version: '0.23.0' });

        const downloadPromise = service.downloadUpdate();
        service.handleDownloadProgress({
            bytesPerSecond: 2048,
            percent: 42.5,
            total: 1000,
            transferred: 425,
        });
        await downloadPromise;

        expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
        expect(service.getStatus()).toMatchObject({
            progress: {
                bytesPerSecond: 2048,
                percent: 42.5,
                total: 1000,
                transferred: 425,
            },
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading,
        });
    });

    it('ignores duplicate download requests while a download is already running', async () => {
        const { service, updater } = createService();
        let resolveDownload: (() => void) | undefined;
        updater.downloadUpdate.mockReturnValueOnce(
            new Promise<string[]>((resolve) => {
                resolveDownload = () => resolve([]);
            })
        );
        service.handleUpdateAvailable({ version: '0.23.0' });

        const firstDownload = service.downloadUpdate();
        const secondStatus = await service.downloadUpdate();
        resolveDownload?.();
        await firstDownload;

        expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
        expect(secondStatus.status).toBe(
            ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading
        );
    });

    it('marks a downloaded update ready to install and installs on request', () => {
        const { service, updater } = createService();
        service.handleUpdateAvailable({ version: '0.23.0' });
        service.handleUpdateDownloaded({ version: '0.23.0' });

        const status: ElectronBridgeAppUpdateStatus = service.getStatus();
        service.installUpdate();

        expect(status.status).toBe(
            ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded
        );
        expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    });

    it('stands the close guard down before quitAndInstall', () => {
        // quitAndInstall closes the windows before 'before-quit' (macOS), so
        // an armed unsaved-settings guard would intercept that close and
        // strand the requested install. prepareQuit must run first.
        const calls: string[] = [];
        const { service, updater } = createService({
            prepareQuit: () => calls.push('prepareQuit'),
        });
        updater.quitAndInstall.mockImplementation(() => {
            calls.push('quitAndInstall');
        });
        service.handleUpdateAvailable({ version: '0.23.0' });
        service.handleUpdateDownloaded({ version: '0.23.0' });

        service.installUpdate();

        expect(calls).toEqual(['prepareQuit', 'quitAndInstall']);
    });

    it('does not stand the close guard down when nothing is installable', () => {
        const prepareQuit = jest.fn();
        const { service, updater } = createService({ prepareQuit });

        service.installUpdate();

        expect(prepareQuit).not.toHaveBeenCalled();
        expect(updater.quitAndInstall).not.toHaveBeenCalled();
    });

    it('takes the close-guard bypass back when quitAndInstall fails', () => {
        // A synchronous updater failure means no quit is coming: the
        // prepared one-shot bypass must not leak into the next genuine
        // close, and the renderer must see a non-Downloaded status so it
        // restores its own unload guard.
        const cancelPreparedQuit = jest.fn();
        const prepareQuit = jest.fn();
        const { service, updater } = createService({
            cancelPreparedQuit,
            prepareQuit,
        });
        updater.quitAndInstall.mockImplementation(() => {
            throw new Error('spawn failed');
        });
        service.handleUpdateAvailable({ version: '0.23.0' });
        service.handleUpdateDownloaded({ version: '0.23.0' });

        const status = service.installUpdate();

        expect(prepareQuit).toHaveBeenCalledTimes(1);
        expect(cancelPreparedQuit).toHaveBeenCalledTimes(1);
        expect(status.status).toBe(ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Error);
    });

    it('takes the bypass back when the updater emits the failure as an error event', () => {
        // electron-updater's BaseUpdater catches synchronous install
        // failures internally and emits 'error' instead of throwing, and
        // MacUpdater can fail after quitAndInstall already returned — the
        // revocation must ride the error path.
        const cancelPreparedQuit = jest.fn();
        const { service } = createService({ cancelPreparedQuit });
        service.handleUpdateAvailable({ version: '0.23.0' });
        service.handleUpdateDownloaded({ version: '0.23.0' });

        service.installUpdate();
        expect(cancelPreparedQuit).not.toHaveBeenCalled();

        // What attachUpdaterEvents forwards from the updater 'error' event.
        service.handleError(new Error('ShipIt failed'));

        expect(cancelPreparedQuit).toHaveBeenCalledTimes(1);
    });

    it('does not revoke a bypass for errors unrelated to an install', () => {
        const cancelPreparedQuit = jest.fn();
        const { service } = createService({ cancelPreparedQuit });

        service.handleError(new Error('check failed'));

        expect(cancelPreparedQuit).not.toHaveBeenCalled();
    });
    it('points electron-updater at the stable repository before every check', async () => {
        const { service, updater } = createService();

        await service.checkForUpdates();

        expect(updater.setFeedURL).toHaveBeenCalledWith({
            provider: 'github',
            owner: '4gray',
            repo: 'iptvnator',
        });
        expect(updater.allowPrerelease).toBe(false);
        expect(updater.channel).toBe('latest');
        expect(updater.allowDowngrade).toBe(false);
        expect(updater.setFeedURL.mock.invocationCallOrder[0]).toBeLessThan(
            updater.checkForUpdates.mock.invocationCallOrder[0]
        );
    });

    it('follows the nightly repository and its prerelease channel when configured', async () => {
        const { service, updater } = createService({ channel: 'nightly' });

        expect(service.getStatus()).toMatchObject({
            channel: 'nightly',
            installedChannel: 'stable',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator-nightly/releases',
        });

        await service.checkForUpdates();

        expect(updater.setFeedURL).toHaveBeenCalledWith({
            provider: 'github',
            owner: '4gray',
            repo: 'iptvnator-nightly',
        });
        expect(updater.allowPrerelease).toBe(true);
        expect(updater.channel).toBe('nightly');
        expect(updater.allowDowngrade).toBe(false);
    });

    it('reports the installed channel from the running version', () => {
        const { service } = createService({
            appVersion: '0.23.1-nightly.20260915.7',
        });

        expect(service.getStatus()).toMatchObject({
            currentVersion: '0.23.1-nightly.20260915.7',
            channel: 'stable',
            installedChannel: 'nightly',
        });
    });

    it('re-checks on an idle updater when the channel changes and forgets the old verdict', async () => {
        const { service, updater, win } = createService();
        await service.checkForUpdates();
        service.handleUpdateNotAvailable({ version: '0.22.0' });
        updater.checkForUpdates.mockClear();

        service.setChannel('stable');
        expect(updater.checkForUpdates).not.toHaveBeenCalled();

        service.setChannel('nightly');
        await Promise.resolve();

        expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
        expect(updater.setFeedURL).toHaveBeenLastCalledWith(
            expect.objectContaining({ repo: 'iptvnator-nightly' })
        );
        const pushed = (
            win.webContents.send.mock.calls as [
                string,
                ElectronBridgeAppUpdateStatus,
            ][]
        ).map(([, status]) => status);
        expect(
            pushed.some(
                (status) =>
                    status.channel === 'nightly' &&
                    status.latestVersion === undefined &&
                    status.release === undefined
            )
        ).toBe(true);
    });

    it('leaves a running download on the old channel but reports the new one', async () => {
        const { service, updater } = createService();
        await service.checkForUpdates();
        service.handleUpdateAvailable({ version: '0.23.0' });
        updater.downloadUpdate.mockImplementationOnce(
            () => new Promise(() => undefined)
        );
        void service.downloadUpdate();
        updater.checkForUpdates.mockClear();

        service.setChannel('nightly');
        await Promise.resolve();

        expect(updater.checkForUpdates).not.toHaveBeenCalled();
        expect(service.getStatus()).toMatchObject({
            channel: 'nightly',
            latestVersion: '0.23.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator-nightly/releases',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading,
            // The retained download still belongs to the channel it was found on.
            verdictChannel: 'stable',
        });
    });

    it('stamps every verdict with the channel it was checked on', async () => {
        const { service } = createService();

        expect(service.getStatus().verdictChannel).toBeUndefined();

        await service.checkForUpdates();
        expect(service.getStatus().verdictChannel).toBe('stable');

        service.handleUpdateNotAvailable({ version: '0.22.0' });
        service.setChannel('nightly');
        await Promise.resolve();

        expect(service.getStatus()).toMatchObject({
            channel: 'nightly',
            verdictChannel: 'nightly',
        });
    });

    it('offers newer nightlies through the manual fallback using prerelease-aware ordering', async () => {
        const fetcher = createChannelReleaseFetcher();
        const { service, updater } = createService({
            appVersion: '0.23.1-nightly.20260914.5',
            channel: 'nightly',
            env: {},
            fetcher,
            platform: 'linux',
        });

        await service.checkForUpdates();

        expect(updater.checkForUpdates).not.toHaveBeenCalled();
        expect(fetcher).toHaveBeenCalledWith(
            'https://api.github.com/repos/4gray/iptvnator-nightly/releases?per_page=10&page=1',
            expect.any(Object)
        );
        // v9.9.9 is not a nightly and must not win the list.
        expect(service.getStatus()).toMatchObject({
            latestVersion: '0.23.1-nightly.20260915.7',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available,
            installedChannel: 'nightly',
        });
    });

    it('never downgrades a nightly build that follows the stable channel', async () => {
        const fetcher = createChannelReleaseFetcher();
        const { service } = createService({
            appVersion: '0.24.1-nightly.20260915.7',
            env: {},
            fetcher,
            platform: 'linux',
        });

        await service.checkForUpdates();

        expect(service.getStatus()).toMatchObject({
            latestVersion: '0.24.0',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.NotAvailable,
            installedChannel: 'nightly',
        });
    });

    it('reloads a fully paged catalog when a version the updater just offered is missing from it', async () => {
        // A snapshot taken before the newest nightly was published: only the
        // older one exists, and it fits in one page, so the catalog believes
        // it has read everything.
        const published: unknown[] = [nightlyReleases[2]];
        const fetcher = jest.fn(async (_url: string) => ({
            json: jest.fn().mockResolvedValue([...published]),
            ok: true,
            status: 200,
            statusText: 'OK',
        }));
        const { service } = createService({ fetcher });

        const older = await service.getReleaseNotes({
            version: '0.23.1-nightly.20260914.5',
        });
        expect(older.tagName).toBe('v0.23.1-nightly.20260914.5');
        expect(fetcher).toHaveBeenCalledTimes(1);

        published.unshift(nightlyReleases[0]);

        const newer = await service.getReleaseNotes({
            version: '0.23.1-nightly.20260915.7',
        });
        expect(newer).toMatchObject({
            tagName: 'v0.23.1-nightly.20260915.7',
            hasNext: false,
            hasPrevious: true,
        });
        expect(fetcher).toHaveBeenCalledTimes(2);

        // A version GitHub really does not have reloads once and then stops.
        await expect(
            service.getReleaseNotes({ version: '0.23.1-nightly.20260916.9' })
        ).rejects.toThrow(
            'Release notes were not found for 0.23.1-nightly.20260916.9'
        );
        expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it('serializes overlapping readers so a reload cannot pull the list out from under a navigation', async () => {
        // Page 1 answers only once the gate opens, so both readers are in
        // flight together; it is a full page (per_page is 10), so the release
        // the navigation needs sits on page 2.
        const pageOne = Array.from({ length: 10 }, (_, offset) => ({
            body: `release ${34 - offset}`,
            draft: false,
            html_url: `https://github.com/4gray/iptvnator/releases/tag/v0.${34 - offset}.0`,
            name: `v0.${34 - offset}.0`,
            prerelease: false,
            published_at: '2026-07-01T00:00:00.000Z',
            tag_name: `v0.${34 - offset}.0`,
        }));
        const pageTwo = githubReleases.slice(1);
        let openGate: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            openGate = resolve;
        });
        const fetcher = jest.fn(async (url: string) => {
            const page = Number(new URL(url).searchParams.get('page') ?? '1');

            if (page === 1) {
                await gate;
            }

            return {
                json: jest
                    .fn()
                    .mockResolvedValue(
                        page === 1 ? pageOne : page === 2 ? pageTwo : []
                    ),
                ok: true,
                status: 200,
                statusText: 'OK',
            };
        });
        const { service } = createService({ fetcher });

        // A version GitHub does not have: this reader resets the catalog.
        const missing = service.getReleaseNotes({ version: '0.99.0' });
        // A navigation that dereferences an index after paging further.
        const navigation = service.getReleaseNotes({
            direction: 'previous',
            version: 'v0.23.0',
        });
        openGate();

        await expect(missing).rejects.toThrow(
            'Release notes were not found for 0.99.0'
        );
        await expect(navigation).resolves.toMatchObject({
            tagName: 'v0.22.0',
            hasNext: true,
            hasPrevious: false,
        });
    });

    it('runs catalog work one caller at a time and survives a rejected caller', async () => {
        const catalog = new AppUpdateReleaseCatalog(
            'stable',
            createReleaseFetcher(),
            'iptvnator/test'
        );
        const order: string[] = [];
        let finishFirst: () => void = () => undefined;

        const first = catalog.runExclusive(async () => {
            order.push('first:start');
            await new Promise<void>((resolve) => {
                finishFirst = resolve;
            });
            order.push('first:end');
            throw new Error('first failed');
        });
        const second = catalog.runExclusive(async () => {
            order.push('second:start');

            return 'second';
        });
        await Promise.resolve();

        expect(order).toEqual(['first:start']);

        finishFirst();

        await expect(first).rejects.toThrow('first failed');
        await expect(second).resolves.toBe('second');
        expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    });

    it('forgets loaded catalogs once the updater reports a newer release', async () => {
        const fetcher = createReleaseFetcher();
        const { service } = createService({ fetcher });

        await service.getReleaseNotes();
        await service.getReleaseNotes();
        expect(fetcher).toHaveBeenCalledTimes(1);

        service.handleUpdateAvailable({ version: '0.25.0' });

        await service.getReleaseNotes();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('reads release notes from the repository the requested version belongs to', async () => {
        const fetcher = createChannelReleaseFetcher();
        const { service } = createService({ fetcher });

        const nightlyNotes = await service.getReleaseNotes({
            version: '0.23.1-nightly.20260915.7',
        });
        expect(nightlyNotes).toMatchObject({
            tagName: 'v0.23.1-nightly.20260915.7',
            hasNext: false,
            hasPrevious: true,
        });

        const previous = await service.getReleaseNotes({
            version: nightlyNotes.tagName,
            direction: 'previous',
        });
        expect(previous.tagName).toBe('v0.23.1-nightly.20260914.5');

        const stableNotes = await service.getReleaseNotes({
            version: '0.23.0',
        });
        expect(stableNotes.tagName).toBe('v0.23.0');

        const latestOnStableChannel = await service.getReleaseNotes();
        expect(latestOnStableChannel.tagName).toBe('v0.24.0');
        expect(
            fetcher.mock.calls.map(([url]) => new URL(url).pathname)
        ).toEqual([
            '/repos/4gray/iptvnator-nightly/releases',
            '/repos/4gray/iptvnator/releases',
        ]);
    });
});
