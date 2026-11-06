import { TestBed } from '@angular/core/testing';
import {
    createContentTestStore,
    createContentTestProviders,
    createPendingRestoreServiceMock,
    PENDING_RESTORE_STATE,
    TEST_PLAYLIST as PLAYLIST,
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
describe('withContent durable favorite conversion', () => {
    let store: InstanceType<typeof TestStore>;
    let dataSource: {
        hasCategories: jest.Mock;
        getCategories: jest.Mock;
        getContent: jest.Mock;
        restoreFavoriteSnapshots: jest.Mock;
    };
    let pendingRestoreService: ReturnType<
        typeof createPendingRestoreServiceMock
    >;
    beforeEach(() => {
        localStorage.clear();
        dataSource = {
            hasCategories: jest.fn().mockResolvedValue(false),
            getCategories: jest.fn().mockResolvedValue([]),
            getContent: jest.fn().mockResolvedValue([]),
            restoreFavoriteSnapshots: jest.fn().mockResolvedValue(undefined),
        };
        pendingRestoreService = createPendingRestoreServiceMock();
        TestBed.configureTestingModule({
            providers: createContentTestProviders(TestStore, {
                dataSource,
                pendingRestoreService,
                dataService: { sendIpcEvent: jest.fn() },
                xtreamApiService: { cancelSession: jest.fn() },
                databaseService: {
                    createOperationId: jest.fn(() => 'import-1'),
                    getXtreamImportStatus: jest.fn().mockResolvedValue('idle'),
                    setXtreamImportStatus: jest.fn().mockResolvedValue(true),
                    clearXtreamImportCache: jest.fn().mockResolvedValue(true),
                },
            }),
        });
        store = TestBed.inject(TestStore);
    });
    afterEach(() => localStorage.clear());
    it('converts legacy favorites before fetching a catalog even when the network fails', async () => {
        pendingRestoreService.getOrThrow.mockReturnValue(PENDING_RESTORE_STATE);
        dataSource.hasCategories.mockResolvedValue(false);
        dataSource.getCategories.mockRejectedValue(new Error('Server offline'));
        await store.initializeContent();
        expect(dataSource.restoreFavoriteSnapshots).toHaveBeenCalledWith(
            PLAYLIST.id,
            PENDING_RESTORE_STATE
        );
        expect(
            dataSource.restoreFavoriteSnapshots.mock.invocationCallOrder[0]
        ).toBeLessThan(dataSource.getCategories.mock.invocationCallOrder[0]);
        expect(pendingRestoreService.clear).not.toHaveBeenCalled();
    });

    it('stops before catalog requests when saved favorites cannot be persisted', async () => {
        pendingRestoreService.getOrThrow.mockReturnValue(PENDING_RESTORE_STATE);
        dataSource.restoreFavoriteSnapshots.mockRejectedValue(
            new Error('SQLite unavailable')
        );
        await store.initializeContent();
        expect(dataSource.getCategories).not.toHaveBeenCalled();
        expect(dataSource.getContent).not.toHaveBeenCalled();
        expect(pendingRestoreService.clear).not.toHaveBeenCalled();
    });
});
