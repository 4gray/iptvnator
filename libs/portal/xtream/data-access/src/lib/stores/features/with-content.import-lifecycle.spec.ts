import { TestBed } from '@angular/core/testing';
import { SourceActivityService } from '@iptvnator/services';
import type { XtreamOperationOptions } from '../../data-sources/xtream-data-source.interface';
import {
    createContentTestProviders,
    createContentTestStore,
    createDeferred,
    createPendingRestoreServiceMock,
    waitForCondition,
} from './with-content.feature.spec-helpers';

const TestStore = createContentTestStore(async () => 'active');

describe('Xtream import session lifecycle', () => {
    let store: InstanceType<typeof TestStore>;
    let dataSource: { getCategories: jest.Mock; getContent: jest.Mock };
    let databaseService: {
        createOperationId: jest.Mock;
        setXtreamImportStatus: jest.Mock;
        clearXtreamImportCache: jest.Mock;
        cancelOperation: jest.Mock;
    };
    let api: { cancelSession: jest.Mock };

    beforeEach(() => {
        localStorage.clear();
        let nextId = 0;
        dataSource = {
            getCategories: jest.fn().mockResolvedValue([]),
            getContent: jest.fn().mockResolvedValue([]),
        };
        databaseService = {
            createOperationId: jest.fn(() => `synthetic-${++nextId}`),
            setXtreamImportStatus: jest.fn().mockResolvedValue(true),
            clearXtreamImportCache: jest.fn().mockResolvedValue(true),
            cancelOperation: jest.fn().mockResolvedValue(false),
        };
        api = { cancelSession: jest.fn().mockResolvedValue(false) };
        TestBed.configureTestingModule({
            providers: createContentTestProviders(TestStore, {
                dataSource,
                databaseService,
                xtreamApiService: api,
                pendingRestoreService: createPendingRestoreServiceMock(),
                dataService: {},
            }),
        });
        store = TestBed.inject(TestStore);
    });

    afterEach(() => localStorage.clear());

    it('defers lock-driven category reloads until the active import finishes', async () => {
        const content = createDeferred<[]>();
        dataSource.getContent.mockReturnValueOnce(content.promise);
        dataSource.getCategories.mockResolvedValue([{ category_id: 'old' }]);
        const task = store.initializeContent();
        await waitForCondition(
            () => dataSource.getContent.mock.calls.length === 1
        );
        store.withholdCatalog();
        dataSource.getCategories.mockResolvedValue([
            { category_id: 'filtered' },
        ]);
        await store.reloadCategories();
        const callsDuringImport = dataSource.getCategories.mock.calls.length;
        content.resolve([]);
        await task;
        expect(callsDuringImport).toBe(3);
        expect(dataSource.getCategories).toHaveBeenCalledTimes(6);
        expect(store.liveCategories()).toEqual([{ category_id: 'filtered' }]);
        expect(store.isContentInitialized()).toBe(true);
    });

    it('aborts data-source work before acknowledging cancellation', async () => {
        const content = createDeferred<[]>();
        let signal: AbortSignal | undefined;
        dataSource.getContent.mockImplementation(
            (
                _p,
                _c,
                _t,
                _progress,
                _total,
                options: XtreamOperationOptions
            ) => {
                signal = options.signal;
                return content.promise;
            }
        );
        const task = store.initializeContent();
        await waitForCondition(
            () => dataSource.getContent.mock.calls.length === 1
        );
        await store.cancelImport();
        const aborted = signal?.aborted;
        content.resolve([]);
        await task;
        expect(aborted).toBe(true);
        expect(databaseService.setXtreamImportStatus).not.toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            'completed'
        );
    });

    it('retains the busy hold and postpones cleanup until sibling category requests settle', async () => {
        const failed = createDeferred<[]>();
        const slow = createDeferred<[]>();
        dataSource.getCategories.mockImplementation(
            (_p, _c, type, options: XtreamOperationOptions) => {
                options.onPhaseChange?.('loading-categories');
                return type === 'live' ? failed.promise : slow.promise;
            }
        );
        let settled = false;
        const task = store.initializeContent().then(() => {
            settled = true;
        });
        await waitForCondition(
            () => dataSource.getCategories.mock.calls.length === 3
        );
        failed.reject(new Error('Synthetic provider failure'));
        await waitForCondition(
            () => settled || api.cancelSession.mock.calls.length > 0
        );
        const heldWhilePending = TestBed.inject(SourceActivityService).isBusy(
            'playlist-1'
        );
        const cleanupWhilePending =
            databaseService.clearXtreamImportCache.mock.calls.length;
        const settledWhilePending = settled;
        slow.resolve([]);
        await task;
        expect(settledWhilePending).toBe(false);
        expect(heldWhilePending).toBe(true);
        expect(cleanupWhilePending).toBe(0);
        expect(store.contentInitBlockReason()).toBe('error');
        expect(databaseService.clearXtreamImportCache).toHaveBeenCalledTimes(3);
    });

    it('ignores category phase callbacks after their session has terminated', async () => {
        let latePhase: XtreamOperationOptions['onPhaseChange'];
        dataSource.getCategories.mockImplementation(
            (_p, _c, type, options: XtreamOperationOptions) => {
                if (type === 'vod') latePhase = options.onPhaseChange;
                options.onPhaseChange?.('loading-categories');
                return type === 'live'
                    ? Promise.reject(new Error('Synthetic provider failure'))
                    : Promise.resolve([]);
            }
        );
        await store.initializeContent();
        latePhase?.('saving-categories');
        expect(store.isImporting()).toBe(false);
        expect(store.importPhase()).toBeNull();
        expect(store.activeImportSessionId()).toBeNull();
    });
});
