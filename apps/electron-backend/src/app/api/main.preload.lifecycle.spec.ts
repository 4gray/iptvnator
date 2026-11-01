import { EventEmitter } from 'node:events';
import type { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import { SOURCE_SYNC_RESUME } from '@iptvnator/shared/interfaces/ipc-commands';

const subscriptions: Array<{
    name: string;
    channel: string;
    subscribe: (api: ElectronBridgeApi, callback: jest.Mock) => () => void;
    forwardsPayload: boolean;
}> = [
    {
        name: 'database operation',
        channel: 'DB_OPERATION_EVENT',
        subscribe: (api, cb) => api.onDbOperationEvent!(cb),
        forwardsPayload: true,
    },
    {
        name: 'playlist refresh',
        channel: 'PLAYLIST:REFRESH_EVENT',
        subscribe: (api, cb) => api.onPlaylistRefreshEvent!(cb),
        forwardsPayload: true,
    },
    {
        name: 'playback position',
        channel: 'playback-position-update',
        subscribe: (api, cb) => api.onPlaybackPositionUpdate(cb),
        forwardsPayload: true,
    },
    {
        name: 'external player session',
        channel: 'EXTERNAL_PLAYER_SESSION_UPDATE',
        subscribe: (api, cb) => api.onExternalPlayerSessionUpdate!(cb),
        forwardsPayload: true,
    },
    {
        name: 'embedded MPV session',
        channel: 'EMBEDDED_MPV_SESSION_UPDATE',
        subscribe: (api, cb) => api.onEmbeddedMpvSessionUpdate!(cb),
        forwardsPayload: true,
    },
    {
        name: 'channel change',
        channel: 'CHANNEL_CHANGE',
        subscribe: (api, cb) => api.onChannelChange!(cb),
        forwardsPayload: true,
    },
    {
        name: 'remote control',
        channel: 'REMOTE_CONTROL_COMMAND',
        subscribe: (api, cb) => api.onRemoteControlCommand!(cb),
        forwardsPayload: true,
    },
    {
        name: 'downloads update',
        channel: 'DOWNLOADS_UPDATE_EVENT',
        subscribe: (api, cb) => api.onDownloadsUpdate(cb),
        forwardsPayload: false,
    },
    {
        name: 'recordings update',
        channel: 'RECORDINGS_UPDATE_EVENT',
        subscribe: (api, cb) => api.onRecordingsUpdate!(cb),
        forwardsPayload: false,
    },
    {
        name: 'source sync resume',
        channel: SOURCE_SYNC_RESUME,
        subscribe: (api, cb) => api.onSourceSyncResume!(cb),
        forwardsPayload: false,
    },
];

const requests: Array<{
    name: string;
    invoke: (api: ElectronBridgeApi) => Promise<unknown>;
    result: unknown;
}> = [
    {
        name: 'import',
        invoke: (api) =>
            api.dbSaveContent('one', [{ stream_id: 7 }], 'movie', 'import-one'),
        result: { success: true, count: 0 },
    },
    {
        name: 'delete',
        invoke: (api) => api.dbDeletePlaylist('one', 'delete-one'),
        result: { success: false, error: 'synthetic delete refusal' },
    },
    {
        name: 'refresh',
        invoke: (api) => api.dbDeleteXtreamContent('one', 'refresh-one'),
        result: {
            success: true,
            favorites: [{ xtreamId: 7, contentType: 'movie' }],
            recentlyViewed: [
                { xtreamId: 8, contentType: 'series', viewedAt: '2026-01-01' },
            ],
            hiddenCategories: [{ xtreamId: 9, categoryType: 'movies' }],
        },
    },
    {
        name: 'restore',
        invoke: (api) =>
            api.dbRestoreXtreamUserData('one', [], [], 'restore-one'),
        result: { success: false, error: 'synthetic restore refusal' },
    },
    {
        name: 'cancel',
        invoke: (api) => api.dbCancelOperation('import-one'),
        result: { success: false },
    },
];

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });
    return { promise, resolve, reject };
}

describe.each([false, true])(
    'preload lifecycle with renderer tracing=%s',
    (tracing) => {
        const envNames = [
            'IPTVNATOR_TRACE_IPC',
            'IPTVNATOR_TRACE_STARTUP',
            'IPTVNATOR_PERF_CAPTURE',
        ] as const;
        const originalEnv = envNames.map(
            (name) => [name, process.env[name]] as const
        );
        const originalDocument = Object.getOwnPropertyDescriptor(
            globalThis,
            'document'
        );
        let api: ElectronBridgeApi;
        let ipc: EventEmitter & {
            invoke: jest.Mock;
            send: jest.Mock;
            sendSync: jest.Mock;
        };

        beforeEach(async () => {
            jest.resetModules();
            for (const name of envNames) delete process.env[name];
            if (tracing) process.env['IPTVNATOR_TRACE_IPC'] = '1';
            ipc = Object.assign(new EventEmitter(), {
                invoke: jest.fn().mockResolvedValue({ success: true }),
                send: jest.fn(),
                sendSync: jest.fn().mockReturnValue(0),
            });
            Object.defineProperty(globalThis, 'document', {
                configurable: true,
                value: { readyState: 'complete' },
            });
            jest.doMock('electron', () => ({
                contextBridge: {
                    exposeInMainWorld: (
                        name: string,
                        exposed: ElectronBridgeApi
                    ) => {
                        expect(name).toBe('electron');
                        api = exposed;
                    },
                },
                ipcRenderer: ipc,
                webFrame: {
                    getZoomLevel: jest.fn().mockReturnValue(0),
                    setZoomLevel: jest.fn(),
                },
                webUtils: { getPathForFile: jest.fn() },
            }));
            await import('./main.preload');
        });

        afterEach(() => {
            ipc.removeAllListeners();
            jest.dontMock('electron');
            jest.restoreAllMocks();
            for (const [name, value] of originalEnv) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
            if (originalDocument)
                Object.defineProperty(globalThis, 'document', originalDocument);
            else Reflect.deleteProperty(globalThis, 'document');
        });

        it.each(subscriptions)(
            '$name strips the privileged event and unsubscribes only its own listener',
            ({ channel, subscribe, forwardsPayload }) => {
                const first = jest.fn();
                const second = jest.fn();
                const removeFirst = subscribe(api, first);
                const removeSecond = subscribe(api, second);
                expect(typeof removeFirst).toBe('function');
                expect(ipc.listenerCount(channel)).toBe(2);
                const privilegedEvent = {
                    sender: { send: jest.fn() },
                    reply: jest.fn(),
                };
                // Payload validation belongs to the producer/consumer. This contract
                // keeps opaque renderer data separate from Electron's privileged event.
                const payload = { sentinel: 'renderer-safe-data' };
                ipc.emit(channel, privilegedEvent, payload);
                const expectedArgs = forwardsPayload ? [payload] : [];
                expect(first.mock.calls).toEqual([expectedArgs]);
                expect(second.mock.calls).toEqual([expectedArgs]);

                removeFirst();
                removeFirst();
                expect(ipc.listenerCount(channel)).toBe(1);
                ipc.emit(channel, privilegedEvent, payload);
                expect(first.mock.calls).toEqual([expectedArgs]);
                expect(second.mock.calls).toEqual([expectedArgs, expectedArgs]);
                removeSecond();
                expect(ipc.listenerCount(channel)).toBe(0);
                ipc.emit(channel, privilegedEvent, payload);
                expect(second).toHaveBeenCalledTimes(2);
            }
        );

        it('removes all legacy import listeners without removing modern DB observers, including after resubscription', () => {
            const modern = jest.fn();
            const removeModern = api.onDbOperationEvent!(modern);
            const legacyFirst = jest.fn();
            const legacySecond = jest.fn();
            api.onDbSaveContentProgress(legacyFirst);
            api.onDbSaveContentProgress(legacySecond);
            const progress = {
                operation: 'save-content',
                status: 'progress',
                increment: 2,
            };
            ipc.emit('DB_OPERATION_EVENT', {}, progress);
            expect(legacyFirst.mock.calls).toEqual([[2]]);
            expect(legacySecond.mock.calls).toEqual([[2]]);
            api.removeDbSaveContentProgress();
            api.removeDbSaveContentProgress();
            expect(ipc.listenerCount('DB_OPERATION_EVENT')).toBe(1);
            ipc.emit('DB_OPERATION_EVENT', {}, progress);
            expect(legacyFirst).toHaveBeenCalledTimes(1);
            expect(legacySecond).toHaveBeenCalledTimes(1);
            expect(modern).toHaveBeenCalledTimes(2);

            const fresh = jest.fn();
            api.onDbSaveContentProgress(fresh);
            ipc.emit('DB_OPERATION_EVENT', {}, progress);
            expect(fresh.mock.calls).toEqual([[2]]);
            expect(legacyFirst).toHaveBeenCalledTimes(1);
            api.removeDbSaveContentProgress();
            expect(ipc.listenerCount('DB_OPERATION_EVENT')).toBe(1);
            removeModern();
            expect(ipc.listenerCount('DB_OPERATION_EVENT')).toBe(0);
        });

        it('forwards only legacy save-content progress and preserves zero increments', () => {
            const progress = jest.fn();
            api.onDbSaveContentProgress(progress);
            for (const status of [
                'started',
                'completed',
                'cancelled',
                'error',
            ]) {
                ipc.emit(
                    'DB_OPERATION_EVENT',
                    {},
                    { operation: 'save-content', status, current: 99 }
                );
            }
            ipc.emit(
                'DB_OPERATION_EVENT',
                {},
                {
                    operation: 'delete-playlist',
                    status: 'progress',
                    current: 99,
                }
            );
            expect(progress).not.toHaveBeenCalled();
            for (const counts of [
                { increment: 0, current: 99 },
                { current: 7 },
                {},
            ]) {
                ipc.emit(
                    'DB_OPERATION_EVENT',
                    {},
                    { operation: 'save-content', status: 'progress', ...counts }
                );
            }
            expect(progress.mock.calls).toEqual([[0], [7], [0]]);
            api.removeDbSaveContentProgress();
        });

        it.each(requests)(
            '$name preserves zero counts, failure results and retained user data',
            async ({ invoke, result }) => {
                ipc.invoke.mockResolvedValueOnce(result);
                await expect(invoke(api)).resolves.toBe(result);
            }
        );

        it.each(requests)(
            '$name propagates an IPC error instead of reporting success',
            async ({ invoke }) => {
                const error = new Error('synthetic IPC rejection');
                ipc.invoke.mockRejectedValueOnce(error);
                await expect(invoke(api)).rejects.toBe(error);
            }
        );

        it('keeps an import rejection independent from its cancellation acknowledgement and DB event subscription', async () => {
            const importResult = deferred<{ count: number }>();
            const cancelResult = deferred<{ success: boolean }>();
            ipc.invoke.mockImplementation((channel: string) => {
                if (channel === 'DB_SAVE_CONTENT') return importResult.promise;
                if (channel === 'DB_CANCEL_OPERATION')
                    return cancelResult.promise;
                throw new Error(`Unexpected channel ${channel}`);
            });
            const events = jest.fn();
            const removeEvents = api.onDbOperationEvent!(events);
            const importing = api.dbSaveContent(
                'one',
                [],
                'movie',
                'import-one'
            );
            const cancelling = api.dbCancelOperation('import-one');
            cancelResult.resolve({ success: true });
            await expect(cancelling).resolves.toEqual({ success: true });
            expect(ipc.listenerCount('DB_OPERATION_EVENT')).toBe(1);
            const terminal = {
                operationId: 'import-one',
                operation: 'save-content',
                status: 'cancelled',
            };
            ipc.emit('DB_OPERATION_EVENT', {}, terminal);
            expect(events.mock.calls).toEqual([[terminal]]);
            const error = Object.assign(new Error('import cancelled'), {
                name: 'AbortError',
            });
            const rejected = expect(importing).rejects.toBe(error);
            importResult.reject(error);
            await rejected;
            expect(ipc.listenerCount('DB_OPERATION_EVENT')).toBe(1);
            removeEvents();
            expect(ipc.listenerCount('DB_OPERATION_EVENT')).toBe(0);
        });
    }
);
