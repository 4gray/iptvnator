import { TestBed } from '@angular/core/testing';
import { PortalStatusType } from '../../xtream-state';
import {
    createAbortError,
    createContentTestProviders,
    createContentTestStore,
    createDeferred,
    createPendingRestoreServiceMock,
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

let checkPortalStatusMock: jest.Mock<Promise<PortalStatusType>, []>;

const TestContentStore = createContentTestStore(() => checkPortalStatusMock());

type PhaseOptions = { onPhaseChange?: (phase: string) => void };

// The 'loading-cached' phase is presentation-only: it drives the sync overlay
// labels but must never mark a real import as started, because the error path
// gates import-cache cleanup on isImporting.
describe('withContent loading-cached phase', () => {
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

    beforeEach(() => {
        localStorage.clear();

        let operationCounter = 0;
        dataSource = {
            getCategories: jest.fn().mockResolvedValue([]),
            getCachedCategories: jest.fn().mockResolvedValue([]),
            getContent: jest.fn().mockResolvedValue([]),
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
        checkPortalStatusMock = jest.fn().mockResolvedValue('active');

        TestBed.configureTestingModule({
            providers: createContentTestProviders(TestContentStore, {
                dataSource,
                databaseService,
                xtreamApiService: {
                    cancelSession: jest.fn().mockResolvedValue(true),
                },
                pendingRestoreService: createPendingRestoreServiceMock(),
                dataService: { sendIpcEvent: jest.fn() },
            }),
        });

        store = TestBed.inject(TestContentStore);
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('publishes the loading-cached phase without marking the import as running', async () => {
        const gate = createDeferred<unknown[]>();
        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                _type: string,
                options?: PhaseOptions
            ) => {
                options?.onPhaseChange?.('loading-cached');
                return gate.promise;
            }
        );

        const initialization = store.initializeContent();
        await waitForCondition(() => store.importPhase() === 'loading-cached');

        expect(store.isImporting()).toBe(false);

        gate.resolve([]);
        await initialization;
    });

    it('keeps a cancelled warm cached read out of import cache cleanup', async () => {
        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                _type: string,
                options?: PhaseOptions
            ) => {
                options?.onPhaseChange?.('loading-cached');
                return Promise.resolve([]);
            }
        );
        dataSource.getContent.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: ContentType,
                _onProgress?: (count: number) => void,
                _onTotal?: (total: number) => void,
                options?: PhaseOptions
            ) => {
                options?.onPhaseChange?.('loading-cached');
                if (type === 'movie') {
                    return Promise.reject(createAbortError());
                }
                return Promise.resolve([]);
            }
        );

        await store.initializeContent();

        // The warm start never touched the provider, so its cancellation must
        // not wipe the healthy cached catalog.
        expect(databaseService.clearXtreamImportCache).not.toHaveBeenCalled();
        expect(store.contentInitBlockReason()).toBe('cancelled');
    });

    it('clears only the type that performed remote work when a mixed import is cancelled', async () => {
        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                _type: string,
                options?: PhaseOptions
            ) => {
                options?.onPhaseChange?.('loading-cached');
                return Promise.resolve([]);
            }
        );
        dataSource.getContent.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                type: ContentType,
                _onProgress?: (count: number) => void,
                _onTotal?: (total: number) => void,
                options?: PhaseOptions
            ) => {
                if (type === 'live') {
                    // Live misses the cache, contacts the provider, then the
                    // user cancels mid-download.
                    options?.onPhaseChange?.('loading-live');
                    return Promise.reject(createAbortError());
                }
                options?.onPhaseChange?.('loading-cached');
                return Promise.resolve([]);
            }
        );

        await store.initializeContent();

        // Only live held partial remote data; vod/series were cache-only and
        // must keep their healthy catalogs.
        expect(databaseService.clearXtreamImportCache).toHaveBeenCalledTimes(1);
        expect(databaseService.clearXtreamImportCache).toHaveBeenCalledWith(
            expect.any(String),
            'live'
        );
    });

    it('still marks the import as running once a remote phase is reported', async () => {
        dataSource.getCategories.mockImplementation(
            (
                _playlistId: string,
                _credentials: unknown,
                _type: string,
                options?: PhaseOptions
            ) => {
                options?.onPhaseChange?.('loading-cached');
                options?.onPhaseChange?.('loading-categories');
                return Promise.resolve([]);
            }
        );
        const gate = createDeferred<unknown[]>();
        dataSource.getContent.mockImplementation(() => gate.promise);

        const initialization = store.initializeContent();
        await waitForCondition(
            () => store.importPhase() === 'loading-categories'
        );

        expect(store.isImporting()).toBe(true);

        gate.resolve([]);
        await initialization;
    });
});
