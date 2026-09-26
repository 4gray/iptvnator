import { TestBed } from '@angular/core/testing';
import { PortalStatusType } from '../../xtream-state';
import {
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

const TestContentStore = createContentTestStore(() =>
    Promise.resolve('active' as PortalStatusType)
);

/**
 * Parental-lock reloads (`reloadCategories` / `reloadCachedContent`) fail
 * closed. Split from `with-content.feature.spec.ts`, which sits at the spec
 * line cap.
 */
describe('withContent parental-lock reloads', () => {
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

    beforeEach(() => {
        localStorage.clear();
        dataSource = {
            getCategories: jest.fn().mockResolvedValue([]),
            getCachedCategories: jest.fn().mockResolvedValue([]),
            getContent: jest.fn().mockResolvedValue([]),
            getCachedContent: jest.fn().mockResolvedValue([]),
            hasCategories: jest.fn().mockResolvedValue(true),
            hasContent: jest.fn().mockResolvedValue(false),
            restoreUserData: jest.fn().mockResolvedValue(undefined),
        };
        TestBed.configureTestingModule({
            providers: createContentTestProviders(TestContentStore, {
                dataSource,
                databaseService: {
                    clearXtreamImportCache: jest.fn().mockResolvedValue(true),
                    cancelOperation: jest.fn().mockResolvedValue(true),
                    createOperationId: jest.fn(
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
                dataService: {
                    sendIpcEvent: jest
                        .fn()
                        .mockResolvedValue({ success: true }),
                },
            }),
        });
        store = TestBed.inject(TestContentStore);
    });

    afterEach(() => localStorage.clear());

    it('withholds every catalog list at once and drops reads whose guard says no', async () => {
        dataSource.getCategories.mockResolvedValue([{ category_id: 'x' }]);
        dataSource.getContent.mockResolvedValue([{ xtream_id: 1 }]);
        await store.initializeContent();
        expect(store.liveStreams()).toEqual([{ xtream_id: 1 }]);

        store.withholdCatalog();
        expect(store.liveCategories()).toEqual([]);
        expect(store.vodStreams()).toEqual([]);
        expect(store.serialStreams()).toEqual([]);
        expect(store.contentLoadStateByType().live).toBe('ready');

        await store.reloadCategories(() => false);
        await store.reloadCachedContent(() => false);
        expect(store.liveCategories()).toEqual([]);
        expect(store.liveStreams()).toEqual([]);

        await store.reloadCachedContent();
        expect(store.liveStreams()).toEqual([{ xtream_id: 1 }]);
    });

    it('withholds rows published by a hydration a relock overtook and reloads them afterwards', async () => {
        const live = createDeferred<unknown[]>();
        let calls = 0;
        dataSource.getContent.mockImplementation(() => {
            calls += 1;
            if (calls === 1) {
                // The hydration's live read is held open; the relock lands
                // while it is in flight.
                return live.promise;
            }
            // Reads 2-3 still belong to the hydration, later ones to the
            // deferred filtered reload.
            return Promise.resolve(
                calls <= 3 ? [{ xtream_id: 1 }] : [{ xtream_id: 2 }]
            );
        });
        let categoryCalls = 0;
        dataSource.getCategories.mockImplementation(async () => {
            categoryCalls += 1;
            return categoryCalls <= 3
                ? [{ category_id: 'old' }]
                : [{ category_id: 'new' }];
        });
        const initialization = store.initializeContent();
        await waitForCondition(() => calls === 1);

        await store.reloadCachedContent();
        expect(calls).toBe(1);

        live.resolve([{ xtream_id: 1 }]);
        await initialization;

        expect(calls).toBe(6);
        expect(categoryCalls).toBe(6);
        expect(store.liveCategories()).toEqual([{ category_id: 'new' }]);
        expect(store.liveStreams()).toEqual([{ xtream_id: 2 }]);
        expect(store.vodStreams()).toEqual([{ xtream_id: 2 }]);
        expect(store.serialStreams()).toEqual([{ xtream_id: 2 }]);
        expect(store.isContentInitialized()).toBe(true);
    });

    it("carries the deferred request's publish guard into the reload", async () => {
        const live = createDeferred<unknown[]>();
        let calls = 0;
        dataSource.getContent.mockImplementation(() => {
            calls += 1;
            return calls === 1
                ? live.promise
                : Promise.resolve([{ xtream_id: calls }]);
        });
        const initialization = store.initializeContent();
        await waitForCondition(() => calls === 1);

        let current = true;
        await store.reloadCachedContent(() => current);
        // The lock moved on again before the hydration settled.
        current = false;
        live.resolve([{ xtream_id: 1 }]);
        await initialization;

        // The reload stops at its first guard check instead of publishing
        // the older rows; the superseding apply reads everything again.
        expect(calls).toBe(4);
        expect(store.liveStreams()).toEqual([]);
        expect(store.vodStreams()).toEqual([]);
        expect(store.serialStreams()).toEqual([]);
    });

    it('empties the category lists when their reload fails', async () => {
        dataSource.getCategories.mockResolvedValue([{ category_id: 'x' }]);
        await store.reloadCategories();
        expect(store.liveCategories()).toEqual([{ category_id: 'x' }]);

        dataSource.getCategories.mockRejectedValue(new Error('db'));
        await store.reloadCategories();

        expect(store.liveCategories()).toEqual([]);
        expect(store.vodCategories()).toEqual([]);
        expect(store.serialCategories()).toEqual([]);
    });

    it('empties a type whose cached reload fails and lets the others reload', async () => {
        dataSource.getContent.mockResolvedValue([{ xtream_id: 1 }]);
        await store.initializeContent();
        expect(store.contentLoadStateByType()).toEqual({
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        });

        dataSource.getContent.mockImplementation(
            (_playlistId: string, _credentials: unknown, type: ContentType) =>
                type === 'movie'
                    ? Promise.reject(new Error('db'))
                    : Promise.resolve([{ xtream_id: 2 }])
        );
        await store.reloadCachedContent();

        expect(store.vodStreams()).toEqual([]);
        expect(store.liveStreams()).toEqual([{ xtream_id: 2 }]);
        expect(store.serialStreams()).toEqual([{ xtream_id: 2 }]);
        expect(store.contentLoadStateByType()).toEqual({
            live: 'ready',
            vod: 'idle',
            series: 'ready',
        });
    });
});
