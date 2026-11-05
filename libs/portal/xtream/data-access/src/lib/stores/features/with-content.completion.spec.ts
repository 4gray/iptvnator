import { TestBed } from '@angular/core/testing';
import {
    createContentTestProviders,
    createContentTestStore,
    createPendingRestoreServiceMock,
    PENDING_RESTORE_STATE,
    TEST_PLAYLIST,
} from './with-content.feature.spec-helpers';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const TestStore = createContentTestStore(async () => 'active');

afterEach(() => localStorage.clear());

it.each(
    (['live', 'movie', 'series'] as const).flatMap((failedType) =>
        [false, true].map((failTerminalStatus) => ({
            failedType,
            failTerminalStatus,
        }))
    )
)(
    'retains recovery and a retry surface ($failedType, terminal write fails=$failTerminalStatus)',
    async ({ failedType, failTerminalStatus }) => {
        const dataSource = {
            getCategories: jest.fn().mockResolvedValue([]),
            getContent: jest.fn(
                async (
                    _id,
                    _credentials,
                    _type,
                    _progress,
                    _total,
                    options
                ) => {
                    options?.onPhaseChange?.('loading-movies');
                    return [];
                }
            ),
            restoreUserData: jest.fn().mockResolvedValue(undefined),
        };
        const pendingRestoreService = createPendingRestoreServiceMock();
        pendingRestoreService.getOrThrow.mockReturnValue(PENDING_RESTORE_STATE);
        const setXtreamImportStatus = jest.fn(
            async (_id, type, status) =>
                type !== failedType ||
                (status !== 'completed' && !failTerminalStatus)
        );
        TestBed.configureTestingModule({
            providers: createContentTestProviders(TestStore, {
                dataSource,
                pendingRestoreService,
                databaseService: {
                    createOperationId: jest
                        .fn()
                        .mockReturnValue('synthetic-operation'),
                    setXtreamImportStatus,
                    clearXtreamImportCache: jest.fn().mockResolvedValue(true),
                    supportsDbOperationCancellation: () => false,
                },
                xtreamApiService: { cancelSession: jest.fn() },
                dataService: { sendIpcEvent: jest.fn() },
            }),
        });
        const store = TestBed.inject(TestStore);
        await store.initializeContent();
        expect(store.isContentInitialized()).toBe(false);
        expect(store.contentInitBlockReason()).toBe('error');
        expect(dataSource.restoreUserData).not.toHaveBeenCalled();
        expect(pendingRestoreService.applyAndConsume).not.toHaveBeenCalled();
        expect(pendingRestoreService.clear).not.toHaveBeenCalled();
        expect(pendingRestoreService.getOrThrow(TEST_PLAYLIST.id)).toEqual(
            PENDING_RESTORE_STATE
        );

        setXtreamImportStatus.mockResolvedValue(true);
        await store.retryContentInitialization();
        expect(store.isContentInitialized()).toBe(true);
        expect(pendingRestoreService.applyAndConsume).toHaveBeenCalledTimes(1);
    }
);
