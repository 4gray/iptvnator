import { TestBed } from '@angular/core/testing';
import { PortalStatusType } from '../../xtream-state';
import {
    createAbortError,
    createContentTestProviders,
    createContentTestStore,
    createDeferred,
    createPendingRestoreServiceMock,
    PENDING_RESTORE_STATE,
    readPendingRestoreBlocked,
    setPerformanceHook,
    TEST_PLAYLIST,
    waitForCondition,
} from './with-content.feature.spec-helpers';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

type ContentType = 'live' | 'movie' | 'series';

const PLAYLIST = TEST_PLAYLIST;

let checkPortalStatusMock: jest.Mock<Promise<PortalStatusType>, []>;

const TestContentStore = createContentTestStore(() => checkPortalStatusMock());

describe('withContent import state', () => {
    let store: InstanceType<typeof TestContentStore>;
    let dataSource: {
        getCategories: jest.Mock;
        getCachedCategories: jest.Mock;
        getContent: jest.Mock;
        getCachedContent: jest.Mock;
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
    let pendingRestoreService: ReturnType<
        typeof createPendingRestoreServiceMock
    >;
    let dataService: { sendIpcEvent: jest.Mock };

    beforeEach(() => {
        localStorage.clear();

        let operationCounter = 0;
        dataSource = {
            getCategories: jest.fn().mockResolvedValue([]),
            getCachedCategories: jest.fn().mockResolvedValue([]),
            getContent: jest.fn(),
            getCachedContent: jest.fn().mockResolvedValue([]),
            hasCategories: jest.fn().mockResolvedValue(true),
            hasContent: jest.fn().mockResolvedValue(false),
            restoreUserData: jest.fn().mockResolvedValue(undefined),
        };
        databaseService = {
            clearXtreamImportCache: jest.fn().mockResolvedValue(true),
            cancelOperation: jest.fn().mockResolvedValue(true),
            createOperationId: jest
                .fn()
                .mockImplementation((prefix?: string) => {
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
        pendingRestoreService = createPendingRestoreServiceMock();
        dataService = {
            sendIpcEvent: jest.fn().mockResolvedValue({ success: true }),
        };
        checkPortalStatusMock = jest.fn().mockResolvedValue('active');

        TestBed.configureTestingModule({
            providers: createContentTestProviders(TestContentStore, {
                dataSource,
                databaseService,
                xtreamApiService,
                pendingRestoreService,
                dataService,
            }),
        });

        store = TestBed.inject(TestContentStore);
    });

    afterEach(() => {
        setPerformanceHook(null);
        localStorage.clear();
    });

    it('emits ordered count-only publication markers for a successful import', async () => {
        const events: RendererPerformancePhaseEvent[] = [];
        setPerformanceHook((event) => events.push(event));
        const categories = {
            live: [{ category_id: '1' }],
            vod: [{ category_id: '2' }, { category_id: '3' }],
            series: [{ category_id: '4' }],
        };
        const content = {
            live: [{ xtream_id: 1 }, { xtream_id: 2 }],
            movie: [{ xtream_id: 3 }],
            series: [{ xtream_id: 4 }, { xtream_id: 5 }],
        };
        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: keyof typeof categories
            ) => Promise.resolve(categories[type])
        );
        dataSource.getContent.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: keyof typeof content
            ) => Promise.resolve(content[type])
        );

        await store.initializeContent();

        expect(
            events.map(({ boundary, metadata, outcome, phase }) => ({
                boundary,
                items: metadata?.items,
                outcome,
                phase,
            }))
        ).toEqual([
            {
                boundary: 'start',
                items: 4,
                outcome: undefined,
                phase: 'store.xtream-publish-categories',
            },
            {
                boundary: 'end',
                items: 4,
                outcome: 'success',
                phase: 'store.xtream-publish-categories',
            },
            {
                boundary: 'start',
                items: 2,
                outcome: undefined,
                phase: 'store.xtream-publish-live',
            },
            {
                boundary: 'end',
                items: 2,
                outcome: 'success',
                phase: 'store.xtream-publish-live',
            },
            {
                boundary: 'start',
                items: 1,
                outcome: undefined,
                phase: 'store.xtream-publish-vod',
            },
            {
                boundary: 'end',
                items: 1,
                outcome: 'success',
                phase: 'store.xtream-publish-vod',
            },
            {
                boundary: 'start',
                items: 2,
                outcome: undefined,
                phase: 'store.xtream-publish-series',
            },
            {
                boundary: 'end',
                items: 2,
                outcome: 'success',
                phase: 'store.xtream-publish-series',
            },
            {
                boundary: 'start',
                items: 5,
                outcome: undefined,
                phase: 'store.xtream-import-terminal',
            },
            {
                boundary: 'end',
                items: 5,
                outcome: 'success',
                phase: 'store.xtream-import-terminal',
            },
        ]);
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
        expect(store.activeImportContentType()).toBe('live');
        expect(store.activeImportCurrentCount()).toBe(1);
        expect(store.activeImportTotalCount()).toBe(2);
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
        expect(store.activeImportContentType()).toBe('vod');
        expect(store.activeImportCurrentCount()).toBe(1);
        expect(store.activeImportTotalCount()).toBe(3);
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
        expect(store.activeImportContentType()).toBe('series');
        expect(store.activeImportCurrentCount()).toBe(1);
        expect(store.activeImportTotalCount()).toBe(4);
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
        expect(store.activeImportContentType()).toBeNull();
        expect(store.activeImportCurrentCount()).toBe(0);
        expect(store.activeImportTotalCount()).toBe(0);
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
            (_playlistId: string, _credentials: unknown, type: ContentType) =>
                pending[type].promise
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
        await waitForCondition(
            () => store.vodCategoriesPlaylistId() === PLAYLIST.id
        );

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
        expect(store.vodStreamsPlaylistId()).toBe(PLAYLIST.id);
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

    it('records the VOD category owner when categories are reloaded', async () => {
        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: 'live' | 'vod' | 'series'
            ) => Promise.resolve([{ category_id: type }])
        );

        await store.reloadCategories();

        expect(store.vodCategories()).toEqual([{ category_id: 'vod' }]);
        expect(store.vodCategoriesPlaylistId()).toBe(PLAYLIST.id);
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

    it('reports section cache availability from persisted categories and content', async () => {
        dataSource.hasCategories.mockResolvedValueOnce(true);
        dataSource.hasContent.mockResolvedValueOnce(true);

        await expect(store.hasUsableOfflineCache('vod')).resolves.toBe(true);

        expect(dataSource.hasCategories).toHaveBeenCalledWith(
            PLAYLIST.id,
            'movies'
        );
        expect(dataSource.hasContent).toHaveBeenCalledWith(
            PLAYLIST.id,
            'movie'
        );
        expect(databaseService.getXtreamImportStatus).not.toHaveBeenCalled();
    });

    it('does not expose offline cache while a restore is pending', async () => {
        pendingRestoreService.getOrThrow.mockReturnValue(PENDING_RESTORE_STATE);
        dataSource.hasCategories.mockResolvedValue(true);
        dataSource.hasContent.mockResolvedValue(true);

        await expect(store.hasUsableOfflineCache('vod')).resolves.toBe(false);
        await store.hydrateCachedContent('vod');

        expect(dataSource.hasCategories).not.toHaveBeenCalled();
        expect(dataSource.hasContent).not.toHaveBeenCalled();
        expect(dataSource.getCachedCategories).not.toHaveBeenCalled();
        expect(dataSource.getCachedContent).not.toHaveBeenCalled();
        expect(dataSource.restoreUserData).not.toHaveBeenCalled();
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBe('error');
    });

    it('blocks active initialization when pending restore storage is unreadable', async () => {
        dataSource.getContent.mockResolvedValue([]);
        pendingRestoreService.getOrThrow.mockImplementation(() => {
            throw new Error('storage is locked');
        });

        await store.initializeContent();

        expect(dataSource.restoreUserData).not.toHaveBeenCalled();
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBe('error');
    });

    it('fails closed when pending restore storage is unreadable', async () => {
        pendingRestoreService.getOrThrow.mockImplementation(() => {
            throw new Error('storage is locked');
        });
        dataSource.hasCategories.mockResolvedValue(true);
        dataSource.hasContent.mockResolvedValue(true);

        await expect(store.hasUsableOfflineCache('vod')).resolves.toBe(false);
        await store.hydrateCachedContent('vod');

        expect(dataSource.hasCategories).not.toHaveBeenCalled();
        expect(dataSource.hasContent).not.toHaveBeenCalled();
        expect(dataSource.getCachedContent).not.toHaveBeenCalled();
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBe('error');

        pendingRestoreService.getOrThrow.mockReturnValue(null);
        checkPortalStatusMock.mockResolvedValue('unavailable');
        dataSource.hasContent.mockResolvedValue(true);
        await store.retryContentInitialization();

        expect(readPendingRestoreBlocked(store)).toBe(false);
        expect(dataSource.getCachedContent).toHaveBeenCalled();
        expect(store.isContentInitialized()).toBe(true);
        expect(store.contentInitBlockReason()).toBeNull();
    });

    it('does not require every content type for aggregate cached sections', async () => {
        dataSource.hasContent
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);

        await expect(
            store.hasUsableOfflineCache('recently-added')
        ).resolves.toBe(true);

        expect(dataSource.hasCategories).not.toHaveBeenCalled();
    });

    it('treats missing category or content cache as unusable for a concrete section', async () => {
        dataSource.hasCategories.mockResolvedValueOnce(true);
        dataSource.hasContent.mockResolvedValueOnce(false);

        await expect(store.hasUsableOfflineCache('live')).resolves.toBe(false);
    });

    it('hydrates persisted section content without remote API loading', async () => {
        dataSource.getCachedCategories.mockResolvedValueOnce([
            {
                id: 1,
                name: 'Movies',
                playlist_id: PLAYLIST.id,
                type: 'movies',
                xtream_id: 10,
                hidden: false,
            },
        ]);
        dataSource.getCachedContent.mockResolvedValueOnce([
            {
                id: 100,
                category_id: 1,
                title: 'Cached Movie',
                rating: '',
                added: '1',
                poster_url: '',
                xtream_id: 1000,
                type: 'movie',
            },
        ]);

        await store.hydrateCachedContent('vod');

        expect(dataSource.getCachedCategories).toHaveBeenCalledWith(
            PLAYLIST.id,
            'vod'
        );
        expect(dataSource.getCachedContent).toHaveBeenCalledWith(
            PLAYLIST.id,
            'movie'
        );
        expect(dataSource.getCategories).not.toHaveBeenCalled();
        expect(dataSource.getContent).not.toHaveBeenCalled();
        expect(store.vodCategories()).toHaveLength(1);
        expect(store.vodStreams()).toHaveLength(1);
        expect(store.vodCategoriesPlaylistId()).toBe(PLAYLIST.id);
        expect(store.vodStreamsPlaylistId()).toBe(PLAYLIST.id);
        expect(store.contentLoadStateByType().vod).toBe('ready');
        expect(store.isCachedContentScopeReady('vod')).toBe(true);
        expect(store.isContentInitialized()).toBe(true);
        expect(store.contentInitBlockReason()).toBeNull();
    });

    it('clears VOD catalog owners with the content state', async () => {
        await store.hydrateCachedContent('vod');
        expect(store.vodCategoriesPlaylistId()).toBe(PLAYLIST.id);
        expect(store.vodStreamsPlaylistId()).toBe(PLAYLIST.id);

        store.resetContent();

        expect(store.vodCategoriesPlaylistId()).toBeNull();
        expect(store.vodStreamsPlaylistId()).toBeNull();
    });

    it('exposes loading state while cached section content is hydrating', async () => {
        const cachedCategories = createDeferred<any[]>();
        const cachedContent = createDeferred<any[]>();
        dataSource.getCachedCategories.mockReturnValueOnce(
            cachedCategories.promise
        );
        dataSource.getCachedContent.mockReturnValueOnce(cachedContent.promise);

        const hydration = store.hydrateCachedContent('vod');
        await Promise.resolve();

        expect(store.isLoadingCategories()).toBe(true);
        expect(store.isLoadingContent()).toBe(true);
        expect(store.contentLoadStateByType().vod).toBe('loading');
        expect(store.isContentInitialized()).toBe(false);

        cachedCategories.resolve([
            {
                id: 1,
                name: 'Movies',
                playlist_id: PLAYLIST.id,
                type: 'movies',
                xtream_id: 10,
                hidden: false,
            },
        ]);
        cachedContent.resolve([
            {
                id: 100,
                category_id: 1,
                title: 'Cached Movie',
                rating: '',
                added: '1',
                poster_url: '',
                xtream_id: 1000,
                type: 'movie',
            },
        ]);

        await hydration;

        expect(store.isLoadingCategories()).toBe(false);
        expect(store.isLoadingContent()).toBe(false);
        expect(store.contentLoadStateByType().vod).toBe('ready');
        expect(store.vodStreams()).toHaveLength(1);
    });

    it('blocks cache publishing when pending state appears during hydration', async () => {
        const cachedCategories = createDeferred<any[]>();
        const cachedContent = createDeferred<any[]>();
        dataSource.getCachedCategories.mockReturnValueOnce(
            cachedCategories.promise
        );
        dataSource.getCachedContent.mockReturnValueOnce(cachedContent.promise);

        const hydration = store.hydrateCachedContent('vod');
        await waitForCondition(
            () => dataSource.getCachedContent.mock.calls.length === 1
        );

        pendingRestoreService.getOrThrow.mockReturnValue(PENDING_RESTORE_STATE);
        cachedCategories.resolve([]);
        cachedContent.resolve([]);

        await hydration;

        expect(dataSource.restoreUserData).not.toHaveBeenCalled();
        expect(pendingRestoreService.clear).not.toHaveBeenCalled();
        expect(store.vodStreams()).toEqual([]);
        expect(store.isContentInitialized()).toBe(false);
        expect(store.isCachedContentScopeReady('vod')).toBe(false);
        expect(store.contentInitBlockReason()).toBe('error');
    });

    it('coalesces concurrent cached hydration calls for the same scope', async () => {
        const cachedCategories = createDeferred<any[]>();
        const cachedContent = createDeferred<any[]>();
        dataSource.getCachedCategories.mockReturnValueOnce(
            cachedCategories.promise
        );
        dataSource.getCachedContent.mockReturnValueOnce(cachedContent.promise);

        const firstHydration = store.hydrateCachedContent('vod');
        await Promise.resolve();
        const secondHydration = store.hydrateCachedContent('vod');

        expect(dataSource.getCachedCategories).toHaveBeenCalledTimes(1);
        expect(dataSource.getCachedContent).toHaveBeenCalledTimes(1);

        cachedCategories.resolve([
            {
                id: 1,
                name: 'Movies',
                playlist_id: PLAYLIST.id,
                type: 'movies',
                xtream_id: 10,
                hidden: false,
            },
        ]);
        cachedContent.resolve([
            {
                id: 100,
                category_id: 1,
                title: 'Cached Movie',
                rating: '',
                added: '1',
                poster_url: '',
                xtream_id: 1000,
                type: 'movie',
            },
        ]);

        await Promise.all([firstHydration, secondHydration]);

        expect(store.contentLoadStateByType().vod).toBe('ready');
        expect(store.vodStreams()).toHaveLength(1);
    });

    it('keeps initialized offline content visible while hydrating another cached type', async () => {
        dataSource.getCachedCategories.mockResolvedValueOnce([
            {
                id: 1,
                name: 'Movies',
                playlist_id: PLAYLIST.id,
                type: 'movies',
                xtream_id: 10,
                hidden: false,
            },
        ]);
        dataSource.getCachedContent.mockResolvedValueOnce([
            {
                id: 100,
                category_id: 1,
                title: 'Cached Movie',
                rating: '',
                added: '1',
                poster_url: '',
                xtream_id: 1000,
                type: 'movie',
            },
        ]);

        await store.hydrateCachedContent('vod');
        expect(store.isContentInitialized()).toBe(true);

        dataSource.getCachedCategories.mockClear();
        dataSource.getCachedContent.mockClear();

        const cachedSeriesCategories = createDeferred<any[]>();
        const cachedSeriesContent = createDeferred<any[]>();
        dataSource.getCachedCategories.mockReturnValueOnce(
            cachedSeriesCategories.promise
        );
        dataSource.getCachedContent.mockReturnValueOnce(
            cachedSeriesContent.promise
        );

        const hydration = store.hydrateCachedContent('series');
        await Promise.resolve();

        expect(store.isContentInitialized()).toBe(true);
        expect(store.contentLoadStateByType()).toEqual({
            live: 'idle',
            vod: 'ready',
            series: 'loading',
        });

        cachedSeriesCategories.resolve([
            {
                id: 2,
                name: 'Series',
                playlist_id: PLAYLIST.id,
                type: 'series',
                xtream_id: 20,
                hidden: false,
            },
        ]);
        cachedSeriesContent.resolve([
            {
                id: 200,
                category_id: 2,
                title: 'Cached Series',
                rating: '',
                added: '1',
                poster_url: '',
                xtream_id: 2000,
                type: 'series',
            },
        ]);

        await hydration;

        expect(store.isContentInitialized()).toBe(true);
        expect(store.contentLoadStateByType().series).toBe('ready');
        expect(store.serialStreams()).toHaveLength(1);
    });

    it('marks aggregate cached hydration scopes ready even when some types are empty', async () => {
        await store.hydrateCachedContent('recently-added');

        expect(dataSource.getCachedCategories).toHaveBeenCalledTimes(3);
        expect(dataSource.getCachedContent).toHaveBeenCalledTimes(3);
        expect(store.contentLoadStateByType()).toEqual({
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        });
        expect(store.isCachedContentScopeReady('recently-added')).toBe(true);
        expect(store.isContentInitialized()).toBe(true);
    });

    it('can mark a routed section as loading before async bootstrap starts', () => {
        store.prepareContentLoading('series');

        expect(store.isLoadingCategories()).toBe(true);
        expect(store.isLoadingContent()).toBe(true);
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBeNull();
        expect(store.contentLoadStateByType()).toEqual({
            live: 'idle',
            vod: 'idle',
            series: 'loading',
        });
    });

    it('ignores concurrent initializeContent calls while an import is already running', async () => {
        const events: RendererPerformancePhaseEvent[] = [];
        setPerformanceHook((event) => events.push(event));
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
        expect(
            events.filter(
                ({ phase }) => phase === 'store.xtream-import-terminal'
            )
        ).toHaveLength(2);
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

    it('keeps a failed pending restore blocked until an explicit retry succeeds', async () => {
        dataSource.getContent.mockResolvedValue([]);
        dataSource.restoreUserData
            .mockRejectedValueOnce(new Error('database is locked'))
            .mockResolvedValueOnce(undefined);
        pendingRestoreService.getOrThrow.mockReturnValue(PENDING_RESTORE_STATE);
        pendingRestoreService.clear.mockImplementation(() => {
            pendingRestoreService.getOrThrow.mockReturnValue(null);
            return true;
        });

        await store.initializeContent();

        expect(dataSource.restoreUserData).toHaveBeenCalledTimes(1);
        expect(pendingRestoreService.clear).not.toHaveBeenCalled();
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBe('error');

        await store.initializeContent();
        expect(dataSource.restoreUserData).toHaveBeenCalledTimes(1);

        // Ready cache rows are not safe to expose while replay is pending:
        // a later full replacement could otherwise erase pins changed in the
        // meantime.
        expect(store.isCachedContentScopeReady('vod')).toBe(false);
        checkPortalStatusMock.mockResolvedValue('unavailable');
        dataSource.hasContent.mockResolvedValue(true);
        await store.retryContentInitialization();

        expect(dataSource.restoreUserData).toHaveBeenCalledTimes(1);
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBe('unavailable');

        checkPortalStatusMock.mockResolvedValue('active');
        await store.retryContentInitialization();

        expect(dataSource.restoreUserData).toHaveBeenCalledTimes(2);
        expect(pendingRestoreService.clear).toHaveBeenCalledWith(
            PLAYLIST.id,
            PENDING_RESTORE_STATE
        );
        expect(store.isContentInitialized()).toBe(true);
        expect(store.contentInitBlockReason()).toBeNull();
    });

    it('leaves state parked during an active import for the next content generation', async () => {
        const pendingSeries = createDeferred<any[]>();
        dataSource.getContent.mockImplementation(
            (_playlistId: string, _credentials: unknown, type: ContentType) =>
                type === 'series' ? pendingSeries.promise : Promise.resolve([])
        );

        const initialization = store.initializeContent();
        await waitForCondition(
            () => store.contentLoadStateByType().vod === 'ready'
        );

        pendingRestoreService.getOrThrow.mockReturnValue(PENDING_RESTORE_STATE);
        expect(store.reconcilePendingRestoreBlock()).toBe(true);
        expect(readPendingRestoreBlocked(store)).toBe(true);
        expect(store.isImporting()).toBe(false);
        expect(store.activeImportSessionId()).not.toBeNull();
        expect(store.isContentInitialized()).toBe(false);
        expect(dataSource.restoreUserData).not.toHaveBeenCalled();

        pendingSeries.resolve([]);
        await initialization;

        expect(dataSource.restoreUserData).not.toHaveBeenCalled();
        expect(readPendingRestoreBlocked(store)).toBe(true);
        expect(store.isContentInitialized()).toBe(false);

        dataSource.getContent.mockResolvedValue([]);
        await store.initializeContent();

        expect(dataSource.restoreUserData).toHaveBeenCalledWith(
            PLAYLIST.id,
            PENDING_RESTORE_STATE,
            expect.any(Object)
        );
        expect(pendingRestoreService.applyAndConsume).toHaveBeenCalledWith(
            PLAYLIST.id,
            expect.objectContaining({
                state: PENDING_RESTORE_STATE,
            }),
            expect.any(Function)
        );
        expect(pendingRestoreService.clear).toHaveBeenCalledWith(
            PLAYLIST.id,
            PENDING_RESTORE_STATE
        );
        expect(readPendingRestoreBlocked(store)).toBe(false);
        expect(store.isContentInitialized()).toBe(true);
    });

    it('retries when pending state could not be consumed', async () => {
        dataSource.getContent.mockResolvedValue([]);
        pendingRestoreService.getOrThrow.mockReturnValue(PENDING_RESTORE_STATE);
        pendingRestoreService.clear
            .mockReturnValueOnce(false)
            .mockImplementationOnce(() => {
                pendingRestoreService.getOrThrow.mockReturnValue(null);
                return true;
            });

        await store.initializeContent();

        expect(dataSource.restoreUserData).toHaveBeenCalledTimes(1);
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBe('error');

        await store.retryContentInitialization();

        expect(dataSource.restoreUserData).toHaveBeenCalledTimes(2);
        expect(pendingRestoreService.clear).toHaveBeenCalledTimes(2);
        expect(store.isContentInitialized()).toBe(true);
        expect(store.contentInitBlockReason()).toBeNull();
    });

    it('keeps cancellation authoritative while a pending restore finishes', async () => {
        const pendingRestore = createDeferred<void>();
        dataSource.getContent.mockResolvedValue([]);
        dataSource.restoreUserData.mockReturnValueOnce(pendingRestore.promise);
        pendingRestoreService.getOrThrow.mockReturnValue(PENDING_RESTORE_STATE);

        const initialization = store.initializeContent();
        await waitForCondition(
            () => dataSource.restoreUserData.mock.calls.length === 1
        );

        await store.cancelImport();
        pendingRestore.reject(new Error('pin replacement failed'));
        await expect(initialization).resolves.toBeUndefined();

        expect(pendingRestoreService.clear).not.toHaveBeenCalled();
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBe('cancelled');
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

    it('hydrates cached content on retry when status remains unavailable', async () => {
        checkPortalStatusMock.mockResolvedValue('unavailable');
        dataSource.hasCategories.mockResolvedValueOnce(true);
        dataSource.hasContent.mockResolvedValueOnce(true);
        dataSource.getCachedCategories.mockResolvedValueOnce([
            {
                id: 1,
                name: 'Movies',
                playlist_id: PLAYLIST.id,
                type: 'movies',
                xtream_id: 10,
                hidden: false,
            },
        ]);
        dataSource.getCachedContent.mockResolvedValueOnce([
            {
                id: 100,
                category_id: 1,
                title: 'Cached Movie',
                rating: '',
                added: '1',
                poster_url: '',
                xtream_id: 1000,
                type: 'movie',
            },
        ]);
        store.setContentInitBlockReason('unavailable');

        await store.retryContentInitialization();

        expect(checkPortalStatusMock).toHaveBeenCalledTimes(1);
        expect(dataSource.getCachedContent).toHaveBeenCalledWith(
            PLAYLIST.id,
            'movie'
        );
        expect(store.contentInitBlockReason()).toBeNull();
        expect(store.vodStreams()).toHaveLength(1);
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
        const events: RendererPerformancePhaseEvent[] = [];
        setPerformanceHook((event) => events.push(event));
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
        expect(store.activeImportContentType()).toBe('live');
        expect(store.activeImportCurrentCount()).toBe(2);
        expect(store.activeImportTotalCount()).toBe(5);

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
        expect(store.activeImportContentType()).toBeNull();
        expect(store.activeImportCurrentCount()).toBe(0);
        expect(store.activeImportTotalCount()).toBe(0);
        expect(store.importCount()).toBe(0);
        expect(store.itemsToImport()).toBe(0);
        expect(
            events
                .filter(({ phase }) => phase === 'store.xtream-import-terminal')
                .map(({ boundary, metadata, outcome }) => ({
                    boundary,
                    items: metadata?.items,
                    outcome,
                }))
        ).toEqual([
            { boundary: 'start', items: 0, outcome: undefined },
            { boundary: 'end', items: 0, outcome: 'success' },
        ]);
    });
});
