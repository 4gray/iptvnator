import {
    APP_UPDATE_CHECK,
    APP_UPDATE_DOWNLOAD,
    APP_UPDATE_GET_RELEASE_NOTES,
    APP_UPDATE_GET_STATUS,
    APP_UPDATE_INSTALL,
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';

const mockHandlers = new Map<string, (...args: unknown[]) => unknown>();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(
            (channel: string, handler: (...args: unknown[]) => unknown) => {
            mockHandlers.set(channel, handler);
        }),
    },
}));

describe('AppUpdateEvents', () => {
    beforeEach(() => {
        jest.resetModules();
        mockHandlers.clear();
    });

    it('registers updater IPC handlers against the provided service', async () => {
        const status: ElectronBridgeAppUpdateStatus = {
            currentVersion: '0.22.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Idle,
            supportedSelfUpdate: true,
        };
        const service = {
            checkForUpdates: jest.fn().mockResolvedValue({
                ...status,
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Checking,
            }),
            downloadUpdate: jest.fn().mockResolvedValue({
                ...status,
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading,
            }),
            getStatus: jest.fn(() => status),
            getReleaseNotes: jest.fn().mockResolvedValue({
                bodyMarkdown: '## Release notes',
                hasNext: false,
                hasPrevious: true,
                htmlUrl:
                    'https://github.com/4gray/iptvnator/releases/tag/v0.23.0',
                publishedAt: '2026-06-28T00:00:00.000Z',
                releaseName: 'v0.23.0',
                tagName: 'v0.23.0',
                version: '0.23.0',
            }),
            installUpdate: jest.fn(() => ({
                ...status,
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded,
            })),
        };
        const { default: AppUpdateEvents } = await import('./app-update.events');

        AppUpdateEvents.bootstrapAppUpdateEvents(service);

        expect([...mockHandlers.keys()].sort()).toEqual([
            APP_UPDATE_CHECK,
            APP_UPDATE_DOWNLOAD,
            APP_UPDATE_GET_RELEASE_NOTES,
            APP_UPDATE_GET_STATUS,
            APP_UPDATE_INSTALL,
        ]);
        expect(await mockHandlers.get(APP_UPDATE_GET_STATUS)?.()).toEqual({
            ...status,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Idle,
        });
        expect(await mockHandlers.get(APP_UPDATE_CHECK)?.()).toEqual({
            ...status,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Checking,
        });
        expect(await mockHandlers.get(APP_UPDATE_DOWNLOAD)?.()).toEqual({
            ...status,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading,
        });
        expect(await mockHandlers.get(APP_UPDATE_INSTALL)?.()).toEqual({
            ...status,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded,
        });
        expect(
            await mockHandlers.get(APP_UPDATE_GET_RELEASE_NOTES)?.(undefined, {
                version: '0.23.0',
            })
        ).toMatchObject({
            bodyMarkdown: '## Release notes',
            tagName: 'v0.23.0',
        });
        expect(service.getReleaseNotes).toHaveBeenCalledWith({
            version: '0.23.0',
        });
    });
});
