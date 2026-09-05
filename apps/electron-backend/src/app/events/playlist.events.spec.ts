import type {
    AutoUpdatePlaylistsResult,
    Playlist,
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
} from '@iptvnator/shared/interfaces';
import {
    AUTO_UPDATE_PLAYLISTS,
    M3U_IMPORT_PERFORMANCE_PHASE,
    M3U_IMPORT_PERFORMANCE_PHASE_EVENT_CHANNEL,
    PLAYLIST_CANCEL_REFRESH,
    PLAYLIST_REFRESH,
    PLAYLIST_REFRESH_EVENT,
} from '@iptvnator/shared/interfaces';
import { channel } from 'node:diagnostics_channel';
import { resolve } from 'node:path';

type IpcHandler = (event: MockIpcEvent, ...args: unknown[]) => Promise<unknown>;

type MockIpcEvent = {
    sender: {
        id: number;
        isDestroyed: jest.Mock<boolean, []>;
        send: jest.Mock;
    };
};

type MockWorker = {
    emit: (event: string, ...args: unknown[]) => boolean;
    on: jest.Mock;
    postMessage: jest.Mock;
    removeAllListeners: jest.Mock;
    terminate: jest.Mock;
};

const mockRegisteredHandlers = new Map<string, IpcHandler>();
const mockAxiosGet = jest.fn();
const mockShowOpenDialog = jest.fn();
const mockShowSaveDialog = jest.fn();
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockParse = jest.fn();
const mockCreatePlaylistObject = jest.fn();
const mockGetFilenameFromUrl = jest.fn();
const mockResolveWorkerRuntimeBootstrap = jest.fn();
const mockWorkerInstances: MockWorker[] = [];
const PERF_CAPTURE_ENV = 'IPTVNATOR_PERF_CAPTURE';
const originalPerformanceCaptureValue = process.env[PERF_CAPTURE_ENV];

jest.mock('electron', () => ({
    app: {
        getAppPath: jest.fn(() => '/mock/app'),
        isPackaged: false,
    },
    dialog: {
        showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args),
        showSaveDialog: (...args: unknown[]) => mockShowSaveDialog(...args),
    },
    ipcMain: {
        handle: jest.fn((channel: string, handler: IpcHandler) => {
            mockRegisteredHandlers.set(channel, handler);
        }),
    },
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: (...args: unknown[]) => mockAxiosGet(...args),
}));

jest.mock('iptv-playlist-parser', () => ({
    parse: (...args: unknown[]) => mockParse(...args),
}));

jest.mock('@iptvnator/shared/m3u-utils', () => ({
    createPlaylistObject: (...args: unknown[]) =>
        mockCreatePlaylistObject(...args),
    getFilenameFromUrl: (...args: unknown[]) => mockGetFilenameFromUrl(...args),
}));

jest.mock('node:fs/promises', () => ({
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

jest.mock('worker_threads', () => {
    const { EventEmitter } = require('events');

    class PlaylistRefreshMockWorker extends EventEmitter {
        postMessage = jest.fn();
        removeAllListeners = jest.fn(() => {
            super.removeAllListeners();
            return this;
        });
        terminate = jest.fn().mockResolvedValue(0);
    }

    return {
        Worker: jest.fn().mockImplementation(() => {
            const worker = new PlaylistRefreshMockWorker();
            mockWorkerInstances.push(worker as MockWorker);
            return worker;
        }),
    };
});

jest.mock('../workers/worker-runtime-paths', () => ({
    resolveWorkerRuntimeBootstrap: (...args: unknown[]) =>
        mockResolveWorkerRuntimeBootstrap(...args),
}));

function createPlaylist(overrides: Partial<Playlist> = {}): Playlist {
    return {
        _id: 'playlist-new',
        autoRefresh: false,
        count: 1,
        favorites: [],
        filename: 'Created playlist',
        importDate: '2026-06-02T00:00:00.000Z',
        lastUsage: '2026-06-02T00:00:00.000Z',
        playlist: { items: [{ id: 'channel-1', url: 'https://stream.test' }] },
        title: 'Created playlist',
        ...overrides,
    };
}

function createIpcEvent(senderId = 1): MockIpcEvent {
    return {
        sender: {
            id: senderId,
            isDestroyed: jest.fn(() => false),
            send: jest.fn(),
        },
    };
}

function getHandler(channel: string): IpcHandler {
    const handler = mockRegisteredHandlers.get(channel);

    if (!handler) {
        throw new Error(`Expected IPC handler for ${channel}`);
    }

    return handler;
}

describe('playlist IPC events', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(async () => {
        jest.resetModules();
        mockRegisteredHandlers.clear();
        mockWorkerInstances.length = 0;
        mockAxiosGet.mockReset();
        mockShowOpenDialog.mockReset();
        mockShowSaveDialog.mockReset();
        mockReadFile.mockReset();
        mockWriteFile.mockReset();
        mockParse.mockReset();
        mockCreatePlaylistObject.mockReset();
        mockGetFilenameFromUrl.mockReset();
        mockResolveWorkerRuntimeBootstrap.mockReset().mockReturnValue({
            nativeModuleSearchPaths: ['/mock/native/modules'],
            workerPath: '/mock/workers/playlist-refresh.worker.js',
            workerPathCandidates: ['/mock/workers/playlist-refresh.worker.js'],
        });
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await import('./playlist.events');
    });

    afterEach(() => {
        if (originalPerformanceCaptureValue === undefined) {
            delete process.env[PERF_CAPTURE_ENV];
        } else {
            process.env[PERF_CAPTURE_ENV] = originalPerformanceCaptureValue;
        }
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    it('fetches a playlist URL, parses it, and returns the created playlist', async () => {
        const parsedPlaylist = { items: [{ name: 'News' }] };
        const playlist = createPlaylist({
            title: 'remote.m3u',
            url: 'https://example.test/remote.m3u',
        });

        mockAxiosGet.mockResolvedValue({ data: '#EXTM3U' });
        mockParse.mockReturnValue(parsedPlaylist);
        mockGetFilenameFromUrl.mockReturnValue('remote.m3u');
        mockCreatePlaylistObject.mockReturnValue(playlist);

        const result = await getHandler('fetch-playlist-by-url')(
            createIpcEvent(),
            'https://example.test/remote.m3u'
        );

        expect(mockAxiosGet).toHaveBeenCalledWith(
            expect.objectContaining({
                httpsAgent: expect.any(Object),
                maxRedirects: 0,
                method: 'GET',
                timeout: 30000,
                url: 'https://example.test/remote.m3u',
            })
        );
        expect(mockParse).toHaveBeenCalledWith('#EXTM3U');
        expect(mockCreatePlaylistObject).toHaveBeenCalledWith(
            'remote.m3u',
            parsedPlaylist,
            'https://example.test/remote.m3u',
            'URL'
        );
        expect(result).toEqual(playlist);
    });

    it.each(['  IPTVnator-Test/1.0  ', '', '   '])(
        'uses and persists the optional initial download User-Agent: %s',
        async (userAgent) => {
            mockAxiosGet.mockResolvedValue({ data: '#EXTM3U' });
            mockParse.mockReturnValue({ items: [] });
            mockCreatePlaylistObject.mockReturnValue(createPlaylist());

            const result = await getHandler('fetch-playlist-by-url')(
                createIpcEvent(),
                'https://example.test/remote.m3u',
                undefined,
                { userAgent }
            );

            const expected = userAgent.trim() || undefined;
            const request = mockAxiosGet.mock.calls[0][0];
            expect(request.headers?.['User-Agent']).toBe(expected);
            expect((result as Playlist).userAgent).toBe(expected);
        }
    );

    it('publishes request-scoped URL import phases only through the opt-in internal channel', async () => {
        process.env[PERF_CAPTURE_ENV] = '1';
        const body = '#EXTM3U\n#EXTINF:-1,News\nhttps://stream.test/news';
        const parsedPlaylist = { items: [{ name: 'News' }] };
        const playlist = createPlaylist({
            title: 'synthetic-performance.m3u',
            url: 'http://127.0.0.1:43210/synthetic-performance.m3u',
        });
        const events: unknown[] = [];
        const performanceChannel = channel(
            M3U_IMPORT_PERFORMANCE_PHASE_EVENT_CHANNEL
        );
        const subscriber = (event: unknown) => events.push(event);

        mockAxiosGet.mockResolvedValue({
            data: body,
            headers: {
                'content-length': String(Buffer.byteLength(body, 'utf8')),
            },
        });
        mockParse.mockReturnValue(parsedPlaylist);
        mockGetFilenameFromUrl.mockReturnValue('synthetic-performance.m3u');
        mockCreatePlaylistObject.mockReturnValue(playlist);
        performanceChannel.subscribe(subscriber);

        try {
            await expect(
                getHandler('fetch-playlist-by-url')(
                    createIpcEvent(),
                    'http://127.0.0.1:43210/synthetic-performance.m3u'
                )
            ).resolves.toBe(playlist);
        } finally {
            performanceChannel.unsubscribe(subscriber);
        }

        expect(
            events.map((event) => {
                const marker = event as {
                    boundary: string;
                    metadata?: { byteCount?: number; itemCount?: number };
                    phase: string;
                    requestId: string;
                };
                return {
                    boundary: marker.boundary,
                    metadata: marker.metadata,
                    phase: marker.phase,
                    requestIdType: typeof marker.requestId,
                };
            })
        ).toEqual([
            {
                boundary: 'start',
                metadata: undefined,
                phase: M3U_IMPORT_PERFORMANCE_PHASE.DATA_ACQUIRE,
                requestIdType: 'string',
            },
            {
                boundary: 'end',
                metadata: { byteCount: Buffer.byteLength(body, 'utf8') },
                phase: M3U_IMPORT_PERFORMANCE_PHASE.DATA_ACQUIRE,
                requestIdType: 'string',
            },
            {
                boundary: 'start',
                metadata: undefined,
                phase: M3U_IMPORT_PERFORMANCE_PHASE.PARSE_M3U,
                requestIdType: 'string',
            },
            {
                boundary: 'end',
                metadata: { itemCount: 1 },
                phase: M3U_IMPORT_PERFORMANCE_PHASE.PARSE_M3U,
                requestIdType: 'string',
            },
            {
                boundary: 'start',
                metadata: undefined,
                phase: M3U_IMPORT_PERFORMANCE_PHASE.NORMALIZE,
                requestIdType: 'string',
            },
            {
                boundary: 'end',
                metadata: { itemCount: 1 },
                phase: M3U_IMPORT_PERFORMANCE_PHASE.NORMALIZE,
                requestIdType: 'string',
            },
        ]);
        expect(
            new Set(events.map((event) => (event as any).requestId)).size
        ).toBe(1);
        expect(JSON.stringify(events)).not.toContain('stream.test');
    });

    it('returns null when the open playlist dialog is cancelled', async () => {
        mockShowOpenDialog.mockResolvedValue({
            canceled: true,
            filePaths: [],
        });

        const result = await getHandler('open-playlist-from-file')(
            createIpcEvent()
        );

        expect(result).toBeNull();
        expect(mockReadFile).not.toHaveBeenCalled();
        expect(mockParse).not.toHaveBeenCalled();
    });

    it('opens a playlist file, derives its title, parses it, and returns the created playlist', async () => {
        const parsedPlaylist = { items: [{ name: 'Local news' }] };
        const playlist = createPlaylist({
            filePath: '/playlists/local-news.m3u8',
            title: 'local-news',
        });

        mockShowOpenDialog.mockResolvedValue({
            canceled: false,
            filePaths: ['/playlists/local-news.m3u8'],
        });
        mockReadFile.mockResolvedValue('#EXTM3U local');
        mockParse.mockReturnValue(parsedPlaylist);
        mockCreatePlaylistObject.mockReturnValue(playlist);

        const result = await getHandler('open-playlist-from-file')(
            createIpcEvent()
        );

        expect(mockReadFile).toHaveBeenCalledWith(
            '/playlists/local-news.m3u8',
            'utf-8'
        );
        expect(mockParse).toHaveBeenCalledWith('#EXTM3U local');
        expect(mockCreatePlaylistObject).toHaveBeenCalledWith(
            'local-news',
            parsedPlaylist,
            '/playlists/local-news.m3u8',
            'FILE'
        );
        expect(result).toEqual(playlist);
    });

    it('auto-updates URL and file playlists while preserving user fields and skipping unusable entries', async () => {
        const sourcePlaylists: Playlist[] = [
            createPlaylist({
                _id: 'url-playlist',
                autoRefresh: true,
                favorites: ['fav-channel'],
                filePath: undefined,
                title: 'URL playlist',
                url: 'https://example.test/list.m3u',
                userAgent: 'PlaylistAgent/1.0',
            }),
            createPlaylist({
                _id: 'file-playlist',
                autoRefresh: false,
                filePath: '/playlists/local.m3u',
                importDate: '',
                title: 'File playlist',
                url: undefined,
            }),
            createPlaylist({
                _id: 'missing-source',
                filePath: undefined,
                title: 'Missing source',
                url: undefined,
            }),
        ];
        const parsedPlaylist = { items: [{ name: 'Updated' }] };

        mockAxiosGet.mockResolvedValue({ data: '#EXTM3U url' });
        mockReadFile.mockResolvedValue('#EXTM3U file');
        mockParse.mockReturnValue(parsedPlaylist);
        mockGetFilenameFromUrl.mockReturnValue('list.m3u');
        // Auto-update refreshes playlists concurrently, so the fixtures are
        // keyed by source type instead of by call order.
        mockCreatePlaylistObject.mockImplementation(
            (_title, _parsed, _source, type) =>
                type === 'URL'
                    ? createPlaylist({
                          _id: 'new-url-playlist',
                          autoRefresh: false,
                          favorites: [],
                          title: 'Updated URL playlist',
                          url: 'https://example.test/list.m3u',
                      })
                    : createPlaylist({
                          _id: 'new-file-playlist',
                          autoRefresh: true,
                          filePath: '/playlists/local.m3u',
                          title: 'Updated file playlist',
                      })
        );

        const result = (await getHandler(AUTO_UPDATE_PLAYLISTS)(
            createIpcEvent(),
            sourcePlaylists
        )) as AutoUpdatePlaylistsResult;

        expect(result.playlists).toEqual([
            expect.objectContaining({
                _id: 'url-playlist',
                autoRefresh: true,
                favorites: ['fav-channel'],
                title: 'Updated URL playlist',
                userAgent: 'PlaylistAgent/1.0',
            }),
            expect.objectContaining({
                _id: 'file-playlist',
                autoRefresh: false,
                favorites: [],
                title: 'Updated file playlist',
            }),
        ]);
        expect(result.outcomes).toEqual([
            {
                playlistId: 'url-playlist',
                status: 'updated',
                title: 'URL playlist',
            },
            {
                playlistId: 'file-playlist',
                status: 'updated',
                title: 'File playlist',
            },
            {
                playlistId: 'missing-source',
                status: 'skipped',
                title: 'Missing source',
            },
        ]);
        expect(mockAxiosGet).toHaveBeenCalledWith(
            expect.objectContaining({
                httpsAgent: expect.any(Object),
                maxRedirects: 0,
                method: 'GET',
                timeout: 30000,
                url: 'https://example.test/list.m3u',
            })
        );
        expect(mockReadFile).toHaveBeenCalledWith(
            '/playlists/local.m3u',
            'utf-8'
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Skipping playlist "Missing source": no URL or file path found'
        );
    });

    it('reports failed playlists as failed outcomes instead of dropping them silently', async () => {
        const sourcePlaylists: Playlist[] = [
            createPlaylist({
                _id: 'unreachable-playlist',
                filePath: undefined,
                title: 'Unreachable playlist',
                url: 'https://unreachable.test/list.m3u',
            }),
            createPlaylist({
                _id: 'file-playlist',
                filePath: '/playlists/local.m3u',
                importDate: '',
                title: 'File playlist',
                url: undefined,
            }),
        ];

        mockAxiosGet.mockRejectedValue(
            new Error('timeout of 30000ms exceeded')
        );
        mockReadFile.mockResolvedValue('#EXTM3U file');
        mockParse.mockReturnValue({ items: [{ name: 'Updated' }] });
        mockCreatePlaylistObject.mockReturnValue(
            createPlaylist({
                _id: 'new-file-playlist',
                filePath: '/playlists/local.m3u',
                title: 'Updated file playlist',
            })
        );

        const result = (await getHandler(AUTO_UPDATE_PLAYLISTS)(
            createIpcEvent(),
            sourcePlaylists
        )) as AutoUpdatePlaylistsResult;

        expect(result.playlists).toEqual([
            expect.objectContaining({
                _id: 'file-playlist',
                title: 'Updated file playlist',
            }),
        ]);
        expect(result.outcomes).toEqual([
            {
                playlistId: 'unreachable-playlist',
                status: 'failed',
                title: 'Unreachable playlist',
            },
            {
                playlistId: 'file-playlist',
                status: 'updated',
                title: 'File playlist',
            },
        ]);
    });

    it('forwards playlist refresh worker events, resolves successful responses, and cleans up the worker', async () => {
        const ipcEvent = createIpcEvent();
        const payload: PlaylistRefreshPayload = {
            operationId: 'refresh-1',
            playlistId: 'playlist-1',
            title: 'Playlist 1',
            url: 'https://example.test/list.m3u',
        };
        const workerEvent: PlaylistRefreshEvent = {
            operationId: 'refresh-1',
            phase: 'fetching',
            playlistId: 'playlist-1',
            status: 'started',
        };
        const playlist = createPlaylist({ _id: 'playlist-1' });

        const refreshPromise = getHandler(PLAYLIST_REFRESH)(ipcEvent, payload);
        const worker = mockWorkerInstances[0];

        expect(mockResolveWorkerRuntimeBootstrap).toHaveBeenCalledWith(
            expect.objectContaining({
                developmentWorkerDir: expect.stringContaining('workers'),
                workerFilename: 'playlist-refresh.worker.js',
            })
        );

        worker.emit('message', { type: 'ready' });
        expect(worker.postMessage).toHaveBeenCalledWith({
            payload,
            type: 'request',
        });

        worker.emit('message', { event: workerEvent, type: 'event' });
        expect(ipcEvent.sender.send).toHaveBeenCalledWith(
            PLAYLIST_REFRESH_EVENT,
            workerEvent
        );

        ipcEvent.sender.send.mockClear();
        ipcEvent.sender.isDestroyed.mockReturnValue(true);
        worker.emit('message', { event: workerEvent, type: 'event' });
        expect(ipcEvent.sender.send).not.toHaveBeenCalled();

        worker.emit('message', {
            result: playlist,
            success: true,
            type: 'response',
        });

        await expect(refreshPromise).resolves.toEqual(playlist);
        expect(worker.removeAllListeners).toHaveBeenCalled();
        expect(worker.terminate).toHaveBeenCalled();
    });

    it('rejects playlist refreshes when the worker emits an error and cleans up the worker', async () => {
        const payload: PlaylistRefreshPayload = {
            operationId: 'refresh-worker-error',
            playlistId: 'playlist-error',
            title: 'Playlist error',
            url: 'https://example.test/error.m3u',
        };
        const refreshPromise = getHandler(PLAYLIST_REFRESH)(
            createIpcEvent(),
            payload
        );
        const worker = mockWorkerInstances[0];

        const rejectedRefresh =
            expect(refreshPromise).rejects.toThrow('worker exploded');

        worker.emit('error', new Error('worker exploded'));

        await rejectedRefresh;
        expect(worker.removeAllListeners).toHaveBeenCalled();
        expect(worker.terminate).toHaveBeenCalled();
        expect(
            await getHandler(PLAYLIST_CANCEL_REFRESH)(
                createIpcEvent(),
                'refresh-worker-error'
            )
        ).toEqual({ success: false });
    });

    it('rejects playlist refreshes when the worker exits before responding', async () => {
        const payload: PlaylistRefreshPayload = {
            operationId: 'refresh-worker-exit',
            playlistId: 'playlist-exit',
            title: 'Playlist exit',
            filePath: '/playlists/exit.m3u',
        };
        const refreshPromise = getHandler(PLAYLIST_REFRESH)(
            createIpcEvent(),
            payload
        );
        const worker = mockWorkerInstances[0];

        const rejectedRefresh = expect(refreshPromise).rejects.toThrow(
            'Playlist refresh worker stopped with exit code 7'
        );

        worker.emit('exit', 7);

        await rejectedRefresh;
        expect(worker.removeAllListeners).toHaveBeenCalled();
        expect(worker.terminate).toHaveBeenCalled();
    });

    it('settles cancellation without waiting for a CPU-bound refresh worker', async () => {
        const ipcEvent = createIpcEvent();
        const payload: PlaylistRefreshPayload = {
            operationId: 'refresh-busy',
            playlistId: 'playlist-busy',
            title: 'Busy playlist',
            filePath: '/playlists/busy.m3u',
        };
        const refreshPromise = getHandler(PLAYLIST_REFRESH)(ipcEvent, payload);
        const worker = mockWorkerInstances[0];
        let outcome:
            | { error: unknown; status: 'rejected' }
            | { status: 'resolved'; value: unknown }
            | undefined;
        void refreshPromise.then(
            (value) => {
                outcome = { status: 'resolved', value };
            },
            (error: unknown) => {
                outcome = { error, status: 'rejected' };
            }
        );

        worker.emit('message', { type: 'ready' });
        worker.emit('message', {
            event: {
                operationId: payload.operationId,
                phase: 'parsing',
                playlistId: payload.playlistId,
                status: 'progress',
            } satisfies PlaylistRefreshEvent,
            type: 'event',
        });

        let finishTermination: ((exitCode: number) => void) | undefined;
        worker.terminate.mockImplementationOnce(
            () =>
                new Promise<number>((resolveTermination) => {
                    finishTermination = resolveTermination;
                })
        );
        const cancelPromise = getHandler(PLAYLIST_CANCEL_REFRESH)(
            createIpcEvent(),
            payload.operationId
        );
        await Promise.resolve();

        expect(worker.removeAllListeners).toHaveBeenCalledTimes(1);
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(worker.postMessage).toHaveBeenLastCalledWith({
            operationId: payload.operationId,
            type: 'cancel',
        });
        expect(outcome).toBeUndefined();
        expect(ipcEvent.sender.send).not.toHaveBeenCalledWith(
            PLAYLIST_REFRESH_EVENT,
            expect.objectContaining({ status: 'cancelled' })
        );

        finishTermination?.(1);
        await expect(cancelPromise).resolves.toEqual({ success: true });
        await Promise.resolve();

        expect(outcome).toEqual({
            status: 'resolved',
            value: {
                operationId: payload.operationId,
                type: 'playlist-refresh-cancelled',
            },
        });
        expect(ipcEvent.sender.send).toHaveBeenLastCalledWith(
            PLAYLIST_REFRESH_EVENT,
            {
                operationId: payload.operationId,
                phase: 'parsing',
                playlistId: payload.playlistId,
                status: 'cancelled',
            }
        );
        await expect(
            getHandler(PLAYLIST_CANCEL_REFRESH)(
                createIpcEvent(),
                payload.operationId
            )
        ).resolves.toEqual({ success: false });
    });

    it('converts playlist refresh worker error responses to Error instances', async () => {
        const payload: PlaylistRefreshPayload = {
            operationId: 'refresh-error',
            playlistId: 'playlist-error',
            title: 'Playlist error',
            filePath: '/playlists/error.m3u',
        };
        const refreshPromise = getHandler(PLAYLIST_REFRESH)(
            createIpcEvent(),
            payload
        );
        const worker = mockWorkerInstances[0];

        const rejectedRefresh = expect(refreshPromise).rejects.toMatchObject({
            message: 'Refresh failed',
            name: 'PlaylistRefreshFailure',
            stack: 'worker stack',
        });

        worker.emit('message', {
            error: {
                message: 'Refresh failed',
                name: 'PlaylistRefreshFailure',
                stack: 'worker stack',
            },
            success: false,
            type: 'response',
        });

        await rejectedRefresh;
    });

    it('returns save dialog paths and writes files through the filesystem handler', async () => {
        const filters = [{ name: 'Playlists', extensions: ['m3u'] }];

        mockShowSaveDialog.mockResolvedValue({
            canceled: false,
            filePath: '/exports/list.m3u',
        });
        mockWriteFile.mockResolvedValue(undefined);

        await expect(
            getHandler('save-file-dialog')(
                createIpcEvent(),
                '/exports/default.m3u',
                filters
            )
        ).resolves.toBe('/exports/list.m3u');
        expect(mockShowSaveDialog).toHaveBeenCalledWith({
            defaultPath: '/exports/default.m3u',
            filters,
        });

        await expect(
            getHandler('write-file')(
                createIpcEvent(),
                '/exports/list.m3u',
                '#EXTM3U'
            )
        ).resolves.toEqual({ success: true });
        expect(mockWriteFile).toHaveBeenCalledWith(
            resolve('/exports/list.m3u'),
            '#EXTM3U',
            'utf-8'
        );
    });

    it('rejects write-file for a path not authorized by a save dialog', async () => {
        mockWriteFile.mockClear();

        await expect(
            getHandler('write-file')(
                createIpcEvent(),
                '/unauthorized/evil.sh',
                'payload'
            )
        ).rejects.toThrow(/not authorized/i);
        expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('scopes save-dialog write authorization to the requesting renderer', async () => {
        mockShowSaveDialog.mockResolvedValue({
            canceled: false,
            filePath: '/exports/private.m3u',
        });

        await getHandler('save-file-dialog')(
            createIpcEvent(1),
            '/exports/private.m3u',
            []
        );

        await expect(
            getHandler('write-file')(
                createIpcEvent(2),
                '/exports/private.m3u',
                '#EXTM3U'
            )
        ).rejects.toThrow(/not authorized/i);
        expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('consumes write authorization even when the filesystem write fails', async () => {
        mockShowSaveDialog.mockResolvedValue({
            canceled: false,
            filePath: '/exports/failure.m3u',
        });
        mockWriteFile.mockRejectedValueOnce(new Error('disk full'));

        const event = createIpcEvent(3);
        await getHandler('save-file-dialog')(event, '/exports/failure.m3u', []);

        await expect(
            getHandler('write-file')(event, '/exports/failure.m3u', '#EXTM3U')
        ).rejects.toThrow('disk full');
        await expect(
            getHandler('write-file')(event, '/exports/failure.m3u', '#EXTM3U')
        ).rejects.toThrow(/not authorized/i);
        expect(mockWriteFile).toHaveBeenCalledTimes(1);
    });
});
