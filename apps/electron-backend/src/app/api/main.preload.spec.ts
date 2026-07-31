import {
    DB_WORKER_OPERATIONS,
    DbWorkerOperation,
} from '../workers/database-worker.types';
import {
    APP_UPDATE_CHECK,
    APP_UPDATE_DOWNLOAD,
    APP_UPDATE_GET_RELEASE_NOTES,
    APP_UPDATE_GET_STATUS,
    APP_UPDATE_INSTALL,
    APP_UPDATE_STATUS_CHANGED,
    ACKNOWLEDGE_PLAYLIST_OPEN_REQUEST,
    ANNOUNCE_PLAYLIST_OPEN_LISTENER,
    OPEN_FILE,
} from '@iptvnator/shared/interfaces';
import type {
    DownloadMetadataSnapshot,
    ElectronBridgeApi,
} from '@iptvnator/shared/interfaces';
import {
    dbPreloadCases,
    epgPreloadCases,
    operationId,
} from './main.preload.spec-data';

type ExposedElectronApi = ElectronBridgeApi &
    Record<string, (...args: unknown[]) => unknown>;

type MockIpcRenderer = {
    invoke: jest.Mock;
    on: jest.Mock;
    off: jest.Mock;
    send: jest.Mock;
};

let mockExposedApi: ExposedElectronApi | null;
let mockIpcRenderer: MockIpcRenderer;
let mockGetPathForFile: jest.Mock;

function getExposedApi(): ExposedElectronApi {
    if (!mockExposedApi) {
        throw new Error('Expected preload API to be exposed');
    }

    return mockExposedApi;
}

function callExposedApiMethod(
    api: ExposedElectronApi,
    method: string,
    args: unknown[]
): unknown {
    const callableApi = api as Record<string, (...args: unknown[]) => unknown>;
    return callableApi[method](...args);
}

describe('main preload DB IPC contract', () => {
    beforeEach(async () => {
        jest.resetModules();
        mockExposedApi = null;
        mockGetPathForFile = jest.fn();
        mockIpcRenderer = {
            invoke: jest.fn().mockResolvedValue({ success: true }),
            on: jest.fn(),
            off: jest.fn(),
            send: jest.fn(),
        };

        jest.doMock('electron', () => ({
            contextBridge: {
                exposeInMainWorld: jest.fn(
                    (_name: string, api: ExposedElectronApi) => {
                        mockExposedApi = api;
                    }
                ),
            },
            ipcRenderer: mockIpcRenderer,
            webUtils: {
                getPathForFile: mockGetPathForFile,
            },
        }));

        await import('./main.preload');
    });

    afterEach(() => {
        jest.dontMock('electron');
    });

    it('covers every worker-backed DB operation exposed by the preload bridge', () => {
        const workerChannels = dbPreloadCases
            .map((contractCase) => contractCase.channel)
            .filter(
                (channel): channel is DbWorkerOperation =>
                    channel !== 'DB_CANCEL_OPERATION' &&
                    DB_WORKER_OPERATIONS.includes(channel as DbWorkerOperation)
            );

        expect(new Set(workerChannels)).toEqual(new Set(DB_WORKER_OPERATIONS));
    });

    it.each(dbPreloadCases)(
        '$method invokes $channel with the expected arguments',
        async ({ method, args, channel, forwardedArgs }) => {
            const api = getExposedApi();

            await callExposedApiMethod(api, method, args);

            expect(mockIpcRenderer.invoke).toHaveBeenLastCalledWith(
                channel,
                ...forwardedArgs
            );
        }
    );

    it.each(epgPreloadCases)(
        '$method invokes $channel with the expected arguments',
        async ({ method, args, channel, forwardedArgs }) => {
            const api = getExposedApi();

            await callExposedApiMethod(api, method, args);

            expect(mockIpcRenderer.invoke).toHaveBeenLastCalledWith(
                channel,
                ...forwardedArgs
            );
        }
    );

    it('forwards scoped user-agent override arguments', async () => {
        const api = getExposedApi();

        await api.setUserAgent(
            'ChannelAgent/1.0',
            'https://portal.example/referrer',
            'https://stream.example/live.m3u8'
        );

        expect(mockIpcRenderer.invoke).toHaveBeenLastCalledWith(
            'set-user-agent',
            'ChannelAgent/1.0',
            'https://portal.example/referrer',
            'https://stream.example/live.m3u8'
        );
    });

    it('exposes app update commands and status events through the typed bridge', async () => {
        const api = getExposedApi();
        const callback = jest.fn();
        const status = {
            currentVersion: '0.22.0',
            latestVersion: '0.23.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: 'available',
            supportedSelfUpdate: true,
        };

        await api.getAppUpdateStatus();
        await api.checkForAppUpdate();
        await api.downloadAppUpdate();
        await api.installAppUpdate();
        await api.getAppUpdateReleaseNotes({
            direction: 'previous',
            version: 'v0.23.0',
        });
        const unsubscribe = api.onAppUpdateStatusChange(callback);
        const handler = mockIpcRenderer.on.mock.calls.at(-1)?.[1];

        handler({}, status);
        unsubscribe();

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
            APP_UPDATE_GET_STATUS
        );
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(APP_UPDATE_CHECK);
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
            APP_UPDATE_DOWNLOAD
        );
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(APP_UPDATE_INSTALL);
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
            APP_UPDATE_GET_RELEASE_NOTES,
            {
                direction: 'previous',
                version: 'v0.23.0',
            }
        );
        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
            APP_UPDATE_STATUS_CHANGED,
            expect.any(Function)
        );
        expect(callback).toHaveBeenCalledWith(status);
        expect(mockIpcRenderer.off).toHaveBeenCalledWith(
            APP_UPDATE_STATUS_CHANGED,
            handler
        );
    });

    it('exposes the playlist open-request announcement and push channel', async () => {
        const api = getExposedApi();
        const callback = jest.fn();
        const request = {
            fileName: 'weekend.m3u',
            filePath: '/home/user/weekend.m3u',
            requestId: 'playlist-open-1',
        };

        await api.announcePlaylistOpenListener();
        await api.acknowledgePlaylistOpenRequest(request.requestId);
        const unsubscribe = api.onPlaylistOpenRequest(callback);
        const handler = mockIpcRenderer.on.mock.calls.at(-1)?.[1];

        handler({}, request);
        unsubscribe();

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
            ANNOUNCE_PLAYLIST_OPEN_LISTENER
        );
        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
            ACKNOWLEDGE_PLAYLIST_OPEN_REQUEST,
            'playlist-open-1'
        );
        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
            OPEN_FILE,
            expect.any(Function)
        );
        expect(callback).toHaveBeenCalledWith(request);
        expect(mockIpcRenderer.off).toHaveBeenCalledWith(OPEN_FILE, handler);
    });

    it('forwards request-scoped DB operation events and unregisters the listener', () => {
        const api = getExposedApi();
        const callback = jest.fn();
        const event = {
            operationId,
            operation: 'save-content',
            status: 'progress',
            current: 5,
            total: 10,
        };

        const unsubscribe = api.onDbOperationEvent(callback) as () => void;
        const handler = mockIpcRenderer.on.mock.calls[0][1];

        handler({}, event);

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
            'DB_OPERATION_EVENT',
            expect.any(Function)
        );
        expect(callback).toHaveBeenCalledWith(event);

        unsubscribe();

        expect(mockIpcRenderer.off).toHaveBeenCalledWith(
            'DB_OPERATION_EVENT',
            handler
        );
    });

    it('preserves a structured playlist cancellation result across the context bridge', async () => {
        const api = getExposedApi();
        const payload = {
            operationId: 'playlist-refresh-cancelled',
            playlistId: 'playlist-1',
            title: 'Large playlist',
            url: 'http://127.0.0.1/large.m3u',
        };
        const cancelledResult = {
            operationId: payload.operationId,
            type: 'playlist-refresh-cancelled',
        } as const;
        mockIpcRenderer.invoke.mockResolvedValueOnce(cancelledResult);

        await expect(api.refreshPlaylist(payload)).resolves.toEqual(
            cancelledResult
        );
        expect(mockIpcRenderer.invoke).toHaveBeenLastCalledWith(
            'PLAYLIST:REFRESH',
            payload
        );
    });

    it('forwards download metadata updates with the download id', async () => {
        const api = getExposedApi();
        const metadataSnapshot: DownloadMetadataSnapshot = {
            version: 1,
            language: 'en',
            mediaKind: 'movie',
            title: 'Offline title',
        };

        await api.downloadsUpdateMetadata(42, metadataSnapshot);

        expect(mockIpcRenderer.invoke).toHaveBeenLastCalledWith(
            'DOWNLOADS_UPDATE_METADATA',
            42,
            metadataSnapshot
        );
    });

    it('keeps the legacy save-content progress bridge scoped to progress events', () => {
        const api = getExposedApi();
        const callback = jest.fn();

        api.onDbSaveContentProgress(callback);
        const handler = mockIpcRenderer.on.mock.calls[0][1];

        handler({}, { operation: 'delete-playlist', status: 'progress' });
        handler({}, { operation: 'save-content', status: 'started' });
        handler(
            {},
            {
                operation: 'save-content',
                status: 'progress',
                current: 25,
                increment: 5,
            }
        );

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(5);

        api.removeDbSaveContentProgress();

        expect(mockIpcRenderer.off).toHaveBeenCalledWith(
            'DB_OPERATION_EVENT',
            handler
        );
    });
});
