import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { DatabaseService } from 'services';
import {
    XTREAM_DATA_SOURCE,
    XtreamPlaylistData,
} from '../../data-sources/xtream-data-source.interface';
import { XtreamApiService } from '../../services/xtream-api.service';
import { PortalStatusType } from '../../xtream-state';
import { withContent } from './with-content.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

type ContentType = 'live' | 'movie' | 'series';

const PLAYLIST: XtreamPlaylistData = {
    id: 'playlist-1',
    name: 'Test Xtream',
    serverUrl: 'http://localhost:8080',
    username: 'demo',
    password: 'secret',
    type: 'xtream',
};

let checkPortalStatusMock: jest.Mock<Promise<PortalStatusType>, []>;

const TestContentStore = signalStore(
    withState({
        playlistId: PLAYLIST.id,
        currentPlaylist: PLAYLIST,
        portalStatus: 'active' as PortalStatusType,
    }),
    withMethods((store) => ({
        async checkPortalStatus(): Promise<PortalStatusType> {
            const status = await checkPortalStatusMock();
            patchState(store, { portalStatus: status });
            return status;
        },
    })),
    withContent()
);

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

function createAbortError(): Error {
    const error = new Error('Import cancelled');
    error.name = 'AbortError';
    return error;
}

async function waitForCondition(
    predicate: () => boolean,
    attempts = 20
): Promise<void> {
    for (let index = 0; index < attempts; index += 1) {
        if (predicate()) {
            return;
        }

        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    throw new Error('Timed out waiting for test condition');
}

describe('withContent import state', () => {
    let store: InstanceType<typeof TestContentStore>;
    let dataSource: {
        getCategories: jest.Mock;
        getContent: jest.Mock;
        hasCategories: jest.Mock;
        hasContent: jest.Mock;
        restoreUserData: jest.Mock;
    };
    let databaseService: {
        clearXtreamImportCache: jest.Mock;
        cancelOperation: jest.Mock;
        createOperationId: jest.Mock;
        getXtreamImportStatus: jest.Mock;
        setXtreamImportStatus: jest.Mock;
        supportsDbOperationCancellation: jest.Mock;
    };
    let xtreamApiService: {
        cancelSession: jest.Mock;
    };

    beforeEach(() => {
        localStorage.clear();

        let operationCounter = 0;
        dataSource = {
            getCategories: jest.fn().mockResolvedValue([]),
            getContent: jest.fn(),
            hasCategories: jest.fn().mockResolvedValue(true),
            hasContent: jest.fn().mockResolvedValue(true),
            restoreUserData: jest.fn().mockResolvedValue(undefined),
        };
        databaseService = {
            clearXtreamImportCache: jest.fn().mockResolvedValue(true),
            cancelOperation: jest.fn().mockResolvedValue(true),
            createOperationId: jest.fn().mockImplementation((prefix?: string) => {
                if (prefix === 'xtream-import-session') {
                    return 'xtream-import-session';
                }

                operationCounter += 1;
                return `${prefix ?? 'db-op'}-${operationCounter}`;
            }),
            getXtreamImportStatus: jest.fn().mockResolvedValue('completed'),
            setXtreamImportStatus: jest.fn().mockResolvedValue(true),
            supportsDbOperationCancellation: jest.fn().mockReturnValue(true),
        };
        xtreamApiService = {
            cancelSession: jest.fn().mockResolvedValue(true),
        };
        checkPortalStatusMock = jest.fn().mockResolvedValue('active');

        TestBed.configureTestingModule({
            providers: [
                TestContentStore,
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: dataSource,
                },
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: XtreamApiService,
                    useValue: xtreamApiService,
                },
            ],
        });

        store = TestBed.inject(TestContentStore);
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('tracks aggregated import progress while content is loading', async () => {
        const pendingCategories = {
            live: createDeferred<any[]>(),
            vod: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };
        const pending = {
            live: createDeferred<any[]>(),
            movie: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };
        const optionsByType = new Map<
            ContentType,
            { onEvent?: (event: any) => void; operationId?: string } | undefined
        >();
        const totals: Record<ContentType, number> = {
            live: 2,
            movie: 3,
            series: 4,
        };

        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: 'live' | 'vod' | 'series'
            ) => pendingCategories[type].promise
        );
        dataSource.getContent.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: ContentType,
                onProgress?: (count: number) => void,
                onTotal?: (total: number) => void,
                options?: { onEvent?: (event: any) => void }
            ) => {
                optionsByType.set(type, options);
                onTotal?.(totals[type]);
                const operationId = options?.operationId ?? `${type}-op`;
                options?.onEvent?.({
                    operation: 'save-content',
                    operationId,
                    status: 'started',
                    phase: 'saving-content',
                });
                onProgress?.(1);
                options?.onEvent?.({
                    operation: 'save-content',
                    operationId,
                    status: 'progress',
                    phase: 'saving-content',
                    current: 1,
                    total: totals[type],
                });

                return pending[type].promise;
            }
        );

        const initialization = store.initializeContent();
        await Promise.resolve();

        pendingCategories.live.resolve([]);
        pendingCategories.vod.resolve([]);
        pendingCategories.series.resolve([]);
        await waitForCondition(() => store.importCount() === 1);

        const liveOperationId =
            optionsByType.get('live')?.operationId ?? 'live-op';
        expect(store.isImporting()).toBe(true);
        expect(store.importCount()).toBe(1);
        expect(store.itemsToImport()).toBe(2);
        expect(store.activeImportOperationIds()).toEqual([liveOperationId]);
        expect(store.importPhase()).toBe('saving-content');

        optionsByType.get('live')?.onEvent?.({
            operation: 'save-content',
            operationId: liveOperationId,
            status: 'completed',
            phase: 'saving-content',
            current: totals.live,
            total: totals.live,
        });
        pending.live.resolve([]);

        await waitForCondition(() => store.importCount() === 2);
        const movieOperationId =
            optionsByType.get('movie')?.operationId ?? 'movie-op';
        expect(store.itemsToImport()).toBe(5);
        expect(store.activeImportOperationIds()).toEqual([movieOperationId]);

        optionsByType.get('movie')?.onEvent?.({
            operation: 'save-content',
            operationId: movieOperationId,
            status: 'completed',
            phase: 'saving-content',
            current: totals.movie,
            total: totals.movie,
        });
        pending.movie.resolve([]);

        await waitForCondition(() => store.importCount() === 3);
        const seriesOperationId =
            optionsByType.get('series')?.operationId ?? 'series-op';
        expect(store.itemsToImport()).toBe(9);
        expect(store.activeImportOperationIds()).toEqual([seriesOperationId]);

        optionsByType.get('series')?.onEvent?.({
            operation: 'save-content',
            operationId: seriesOperationId,
            status: 'completed',
            phase: 'saving-content',
            current: totals.series,
            total: totals.series,
        });
        pending.series.resolve([]);

        await initialization;

        expect(store.isImporting()).toBe(false);
        expect(store.isContentInitialized()).toBe(true);
        expect(store.contentInitBlockReason()).toBeNull();
        expect(store.contentLoadStateByType()).toEqual({
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        });
        expect(store.activeImportOperationIds()).toEqual([]);
        expect(store.importPhase()).toBeNull();
        expect(store.importCount()).toBe(0);
        expect(store.itemsToImport()).toBe(0);
    });

    it('marks content types ready and patches their streams as each import completes', async () => {
        const pendingCategories = {
            live: createDeferred<any[]>(),
            vod: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };
        const pending = {
            live: createDeferred<any[]>(),
            movie: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };

        const liveItems = [
            {
                xtream_id: 101,
                category_id: 11,
                title: 'Live One',
            },
        ];
        const vodItems = [
            {
                xtream_id: 202,
                category_id: 22,
                title: 'Movie One',
            },
        ];
        const seriesItems = [
            {
                xtream_id: 303,
                category_id: 33,
                title: 'Series One',
            },
        ];

        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: 'live' | 'vod' | 'series'
            ) => pendingCategories[type].promise
        );
        dataSource.getContent.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: ContentType
            ) => pending[type].promise
        );

        const initialization = store.initializeContent();
        await Promise.resolve();

        expect(store.contentLoadStateByType()).toEqual({
            live: 'loading',
            vod: 'loading',
            series: 'loading',
        });

        pendingCategories.live.resolve([]);
        pendingCategories.vod.resolve([]);
        pendingCategories.series.resolve([]);

        pending.live.resolve(liveItems);
        await waitForCondition(
            () => store.contentLoadStateByType().live === 'ready'
        );

        expect(store.liveStreams()).toEqual(liveItems);
        expect(store.contentLoadStateByType()).toEqual({
            live: 'ready',
            vod: 'loading',
            series: 'loading',
        });
        expect(store.isContentInitialized()).toBe(false);

        pending.movie.resolve(vodItems);
        await waitForCondition(
            () => store.contentLoadStateByType().vod === 'ready'
        );

        expect(store.vodStreams()).toEqual(vodItems);
        expect(store.contentLoadStateByType()).toEqual({
            live: 'ready',
            vod: 'ready',
            series: 'loading',
        });
        expect(store.isContentInitialized()).toBe(false);

        pending.series.resolve(seriesItems);
        await initialization;

        expect(store.serialStreams()).toEqual(seriesItems);
        expect(store.contentLoadStateByType()).toEqual({
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        });
        expect(store.isContentInitialized()).toBe(true);
    });

    it('loads categories before starting content import', async () => {
        const pendingCategories = {
            live: createDeferred<any[]>(),
            vod: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };

        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: 'live' | 'vod' | 'series'
            ) => pendingCategories[type].promise
        );
        dataSource.getContent.mockResolvedValue([]);

        const initialization = store.initializeContent();
        await Promise.resolve();

        expect(dataSource.getCategories).toHaveBeenCalledTimes(3);
        expect(dataSource.getContent).not.toHaveBeenCalled();

        pendingCategories.live.resolve([]);
        pendingCategories.vod.resolve([]);
        pendingCategories.series.resolve([]);

        await initialization;

        expect(dataSource.getContent).toHaveBeenCalledTimes(3);
    });

    it('reuses cached content without clearing the playlist import cache', async () => {
        dataSource.getCategories.mockResolvedValue([]);
        dataSource.getContent.mockResolvedValue([]);

        const initialization = store.initializeContent();
        await Promise.resolve();

        expect(store.isImporting()).toBe(false);

        await initialization;

        expect(store.isImporting()).toBe(false);
        expect(store.isContentInitialized()).toBe(true);
        expect(store.contentInitBlockReason()).toBeNull();
        expect(databaseService.clearXtreamImportCache).not.toHaveBeenCalled();
        expect(databaseService.setXtreamImportStatus).not.toHaveBeenCalledWith(
            PLAYLIST.id,
            expect.anything(),
            'importing'
        );
    });

    it('reports offline cache availability only when every import type is completed and cached', async () => {
        databaseService.getXtreamImportStatus
            .mockResolvedValueOnce('completed')
            .mockResolvedValueOnce('completed')
            .mockResolvedValueOnce('completed');
        dataSource.hasCategories
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);
        dataSource.hasContent
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);

        await expect(store.hasUsableOfflineCache()).resolves.toBe(true);

        expect(databaseService.getXtreamImportStatus).toHaveBeenNthCalledWith(
            1,
            PLAYLIST.id,
            'live'
        );
        expect(databaseService.getXtreamImportStatus).toHaveBeenNthCalledWith(
            2,
            PLAYLIST.id,
            'movie'
        );
        expect(databaseService.getXtreamImportStatus).toHaveBeenNthCalledWith(
            3,
            PLAYLIST.id,
            'series'
        );
    });

    it('treats partial cache as unusable for offline initialization', async () => {
        databaseService.getXtreamImportStatus
            .mockResolvedValueOnce('completed')
            .mockResolvedValueOnce('completed')
            .mockResolvedValueOnce('completed');
        dataSource.hasCategories
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);
        dataSource.hasContent
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        await expect(store.hasUsableOfflineCache()).resolves.toBe(false);
    });

    it('ignores concurrent initializeContent calls while an import is already running', async () => {
        const pendingCategories = {
            live: createDeferred<any[]>(),
            vod: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };

        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: 'live' | 'vod' | 'series'
            ) => pendingCategories[type].promise
        );
        dataSource.getContent.mockResolvedValue([]);

        const firstInitialization = store.initializeContent();
        const secondInitialization = store.initializeContent();
        await Promise.resolve();

        expect(store.activeImportSessionId()).toBe('xtream-import-session');
        expect(dataSource.getCategories).toHaveBeenCalledTimes(3);
        expect(dataSource.getContent).not.toHaveBeenCalled();

        pendingCategories.live.resolve([]);
        pendingCategories.vod.resolve([]);
        pendingCategories.series.resolve([]);

        await Promise.all([firstInitialization, secondInitialization]);

        expect(dataSource.getCategories).toHaveBeenCalledTimes(3);
        expect(dataSource.getContent).toHaveBeenCalledTimes(3);
    });

    it('blocks auto restart after cancelling during category loading until retry is explicit', async () => {
        const pendingCategories = {
            live: createDeferred<any[]>(),
            vod: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };

        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: 'live' | 'vod' | 'series'
            ) => pendingCategories[type].promise
        );
        dataSource.getContent.mockResolvedValue([]);

        const initialization = store.initializeContent();
        await waitForCondition(() => Boolean(store.activeImportSessionId()));

        await store.cancelImport();

        expect(store.isCancellingImport()).toBe(true);
        expect(store.contentInitBlockReason()).toBe('cancelled');
        expect(databaseService.cancelOperation).not.toHaveBeenCalled();
        expect(xtreamApiService.cancelSession).toHaveBeenCalledWith(
            'xtream-import-session'
        );

        pendingCategories.live.reject(createAbortError());
        pendingCategories.vod.reject(createAbortError());
        pendingCategories.series.reject(createAbortError());

        await expect(initialization).resolves.toBeUndefined();

        expect(store.isImporting()).toBe(false);
        expect(store.isCancellingImport()).toBe(false);
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBe('cancelled');
        expect(store.contentLoadStateByType()).toEqual({
            live: 'idle',
            vod: 'idle',
            series: 'idle',
        });

        await store.initializeContent();

        expect(dataSource.getCategories).toHaveBeenCalledTimes(3);
        expect(dataSource.getContent).not.toHaveBeenCalled();

        dataSource.getCategories.mockResolvedValue([]);
        dataSource.getContent.mockResolvedValue([]);

        await store.retryContentInitialization();

        expect(checkPortalStatusMock).toHaveBeenCalledTimes(1);
        expect(store.contentInitBlockReason()).toBeNull();
        expect(store.isContentInitialized()).toBe(true);
        expect(dataSource.getCategories).toHaveBeenCalledTimes(6);
        expect(dataSource.getContent).toHaveBeenCalledTimes(3);
    });

    it('stops before content fetch if cancel lands between categories and content phases', async () => {
        const pendingCategories = {
            live: createDeferred<any[]>(),
            vod: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };

        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: 'live' | 'vod' | 'series'
            ) => pendingCategories[type].promise
        );
        dataSource.getContent.mockResolvedValue([]);

        const initialization = store.initializeContent();
        await waitForCondition(() => Boolean(store.activeImportSessionId()));

        pendingCategories.live.resolve([]);
        pendingCategories.vod.resolve([]);
        pendingCategories.series.resolve([]);

        await store.cancelImport();
        await expect(initialization).resolves.toBeUndefined();

        expect(store.contentInitBlockReason()).toBe('cancelled');
        expect(store.isContentInitialized()).toBe(false);
        expect(dataSource.getContent).not.toHaveBeenCalled();
    });

    it('keeps the blocked state when retry finds a non-active portal status', async () => {
        checkPortalStatusMock.mockResolvedValue('expired');
        store.setContentInitBlockReason('cancelled');

        await store.retryContentInitialization();

        expect(checkPortalStatusMock).toHaveBeenCalledTimes(1);
        expect(store.contentInitBlockReason()).toBe('expired');
        expect(store.isContentInitialized()).toBe(false);
        expect(dataSource.getCategories).not.toHaveBeenCalled();
        expect(dataSource.getContent).not.toHaveBeenCalled();
    });

    it('keeps a cancelled block sticky until retry or reset clears it', async () => {
        store.setContentInitBlockReason('cancelled');

        store.setContentInitBlockReason(null);

        expect(store.contentInitBlockReason()).toBe('cancelled');

        dataSource.getCategories.mockResolvedValue([]);
        dataSource.getContent.mockResolvedValue([]);

        await store.retryContentInitialization();

        expect(store.contentInitBlockReason()).toBeNull();
        expect(store.isContentInitialized()).toBe(true);
    });

    it('cancels active imports and clears stale progress after worker aborts', async () => {
        const pendingCategories = {
            live: createDeferred<any[]>(),
            vod: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };
        const pending = {
            live: createDeferred<any[]>(),
            movie: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };
        const optionsByType = new Map<
            ContentType,
            { onEvent?: (event: any) => void; operationId?: string } | undefined
        >();

        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: 'live' | 'vod' | 'series'
            ) => pendingCategories[type].promise
        );
        dataSource.getContent.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: ContentType,
                onProgress?: (count: number) => void,
                onTotal?: (total: number) => void,
                options?: { onEvent?: (event: any) => void }
            ) => {
                optionsByType.set(type, options);
                onTotal?.(5);
                const operationId = options?.operationId ?? `${type}-op`;
                options?.onEvent?.({
                    operation: 'save-content',
                    operationId,
                    status: 'started',
                    phase: 'saving-content',
                });
                onProgress?.(2);
                options?.onEvent?.({
                    operation: 'save-content',
                    operationId,
                    status: 'progress',
                    phase: 'saving-content',
                    current: 2,
                    total: 5,
                });

                return pending[type].promise;
            }
        );

        const initialization = store.initializeContent();
        await Promise.resolve();

        pendingCategories.live.resolve([]);
        pendingCategories.vod.resolve([]);
        pendingCategories.series.resolve([]);
        await waitForCondition(
            () => store.activeImportOperationIds().length === 1
        );
        const liveOperationId =
            optionsByType.get('live')?.operationId ?? 'live-op';

        await store.cancelImport();

        expect(store.isCancellingImport()).toBe(true);
        expect(databaseService.cancelOperation).toHaveBeenCalledTimes(1);
        expect(databaseService.cancelOperation).toHaveBeenCalledWith(
            liveOperationId
        );
        expect(xtreamApiService.cancelSession).toHaveBeenCalledWith(
            'xtream-import-session'
        );

        optionsByType.get('live')?.onEvent?.({
            operation: 'save-content',
            operationId: liveOperationId,
            status: 'cancelled',
            phase: 'saving-content',
        });
        pending.live.reject(createAbortError());

        await expect(initialization).resolves.toBeUndefined();

        expect(store.isImporting()).toBe(false);
        expect(store.isCancellingImport()).toBe(false);
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBe('cancelled');
        expect(store.contentLoadStateByType()).toEqual({
            live: 'idle',
            vod: 'idle',
            series: 'idle',
        });
        expect(store.activeImportOperationIds()).toEqual([]);
        expect(store.importPhase()).toBeNull();
        expect(store.importCount()).toBe(0);
        expect(store.itemsToImport()).toBe(0);
    });
});
