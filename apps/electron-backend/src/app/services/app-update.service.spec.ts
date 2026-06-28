import { EventEmitter } from 'events';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { AppUpdateService } from './app-update.service';

class FakeUpdater extends EventEmitter {
    autoDownload = true;
    autoInstallOnAppQuit = true;
    checkForUpdates = jest.fn().mockResolvedValue(null);
    downloadUpdate = jest.fn().mockResolvedValue([]);
    quitAndInstall = jest.fn();
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
    } = {}
) {
    const updater = new FakeUpdater();
    const win = createWindow();
    const service = new AppUpdateService({
        app: {
            getVersion: () => '0.22.0',
            isPackaged: overrides.isPackaged ?? true,
        },
        getMainWindow: () => win,
        platform: overrides.platform ?? 'darwin',
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
        });

        await service.checkForUpdatesOnStartup();

        expect(updaterFactory).not.toHaveBeenCalled();
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
});
