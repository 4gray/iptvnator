import { TestBed } from '@angular/core/testing';
import { CONNECTIVITY_GUARD_RESET } from '@iptvnator/shared/interfaces';
import { PortalStatusType } from '../../xtream-state';
import {
    createContentTestProviders,
    createContentTestStore,
    createPendingRestoreServiceMock,
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

let checkPortalStatusMock: jest.Mock<Promise<PortalStatusType>, []>;

const TestContentStore = createContentTestStore(() => checkPortalStatusMock());

describe('withContent host connectivity guard', () => {
    let store: InstanceType<typeof TestContentStore>;
    let dataService: { sendIpcEvent: jest.Mock };

    beforeEach(() => {
        localStorage.clear();
        checkPortalStatusMock = jest.fn().mockResolvedValue('active');
        dataService = {
            sendIpcEvent: jest.fn().mockResolvedValue({ success: true }),
        };

        TestBed.configureTestingModule({
            providers: createContentTestProviders(TestContentStore, {
                dataSource: {
                    getCategories: jest.fn().mockResolvedValue([]),
                    getCachedCategories: jest.fn().mockResolvedValue([]),
                    getContent: jest.fn().mockResolvedValue([]),
                    getCachedContent: jest.fn().mockResolvedValue([]),
                    hasCategories: jest.fn().mockResolvedValue(true),
                    hasContent: jest.fn().mockResolvedValue(false),
                    restoreUserData: jest.fn().mockResolvedValue(undefined),
                },
                databaseService: {
                    clearXtreamImportCache: jest.fn().mockResolvedValue(true),
                    cancelOperation: jest.fn().mockResolvedValue(true),
                    createOperationId: jest
                        .fn()
                        .mockImplementation(
                            (prefix?: string) => `${prefix ?? 'db-op'}-1`
                        ),
                    getXtreamImportStatus: jest
                        .fn()
                        .mockResolvedValue('completed'),
                    setXtreamImportStatus: jest.fn().mockResolvedValue(true),
                    supportsDbOperationCancellation: jest
                        .fn()
                        .mockReturnValue(true),
                },
                xtreamApiService: {
                    cancelSession: jest.fn().mockResolvedValue(true),
                },
                pendingRestoreService: createPendingRestoreServiceMock(),
                dataService,
            }),
        });

        store = TestBed.inject(TestContentStore);
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('clears the guard before the portal status check the retry depends on', async () => {
        // Ordering is the whole point. A tripped guard fast-fails that status
        // check, which resolves to 'unavailable' and returns early — so a reset
        // placed after it would never run, and the Retry button would silently
        // do nothing until the guard's window expired on its own.
        const order: string[] = [];
        dataService.sendIpcEvent.mockImplementation((event: string) => {
            order.push(`ipc:${event}`);
            return Promise.resolve({ success: true });
        });
        checkPortalStatusMock.mockImplementation(() => {
            order.push('checkPortalStatus');
            return Promise.resolve('unavailable' as PortalStatusType);
        });

        await store.retryContentInitialization();

        expect(order).toEqual([
            `ipc:${CONNECTIVITY_GUARD_RESET}`,
            'checkPortalStatus',
        ]);
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            CONNECTIVITY_GUARD_RESET,
            { url: TEST_PLAYLIST.serverUrl }
        );
    });

    it('retries anyway when clearing the guard fails', async () => {
        dataService.sendIpcEvent.mockRejectedValue(
            new Error('IPC unavailable')
        );

        await store.retryContentInitialization();

        expect(checkPortalStatusMock).toHaveBeenCalled();
        expect(store.isContentInitialized()).toBe(true);
    });

    it('leaves the guard alone for an ordinary initialization', async () => {
        // Only a user-driven retry means "contact this host now"; the automatic
        // first load must not clear evidence the guard just collected.
        await store.initializeContent();

        expect(dataService.sendIpcEvent).not.toHaveBeenCalledWith(
            CONNECTIVITY_GUARD_RESET,
            expect.anything()
        );
    });
});
