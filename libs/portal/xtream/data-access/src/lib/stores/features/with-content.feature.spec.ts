import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import { DatabaseService } from 'services';
import {
    XTREAM_DATA_SOURCE,
    XtreamPlaylistData,
} from '../../data-sources/xtream-data-source.interface';
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

const TestContentStore = signalStore(
    withState({
        playlistId: PLAYLIST.id,
        currentPlaylist: PLAYLIST,
    }),
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

describe('withContent import state', () => {
    let store: InstanceType<typeof TestContentStore>;
    let dataSource: {
        getCategories: jest.Mock;
        getContent: jest.Mock;
        restoreUserData: jest.Mock;
    };
    let databaseService: {
        cancelOperation: jest.Mock;
        supportsDbOperationCancellation: jest.Mock;
    };

    beforeEach(() => {
        localStorage.clear();

        dataSource = {
            getCategories: jest.fn().mockResolvedValue([]),
            getContent: jest.fn(),
            restoreUserData: jest.fn().mockResolvedValue(undefined),
        };
        databaseService = {
            cancelOperation: jest.fn().mockResolvedValue(true),
            supportsDbOperationCancellation: jest.fn().mockReturnValue(true),
        };

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
            ],
        });

        store = TestBed.inject(TestContentStore);
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('tracks aggregated import progress while content is loading', async () => {
        const pending = {
            live: createDeferred<any[]>(),
            movie: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };
        const optionsByType = new Map<
            ContentType,
            { onEvent?: (event: any) => void } | undefined
        >();
        const totals: Record<ContentType, number> = {
            live: 2,
            movie: 3,
            series: 4,
        };

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
                options?.onEvent?.({
                    operation: 'save-content',
                    operationId: `${type}-op`,
                    status: 'started',
                    phase: 'saving-content',
                });
                onProgress?.(1);
                options?.onEvent?.({
                    operation: 'save-content',
                    operationId: `${type}-op`,
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

        expect(store.isImporting()).toBe(true);
        expect(store.importCount()).toBe(3);
        expect(store.itemsToImport()).toBe(9);
        expect(store.activeImportOperationIds().sort()).toEqual([
            'live-op',
            'movie-op',
            'series-op',
        ]);
        expect(store.importPhase()).toBe('saving-content');

        (['live', 'movie', 'series'] as ContentType[]).forEach((type) => {
            optionsByType.get(type)?.onEvent?.({
                operation: 'save-content',
                operationId: `${type}-op`,
                status: 'completed',
                phase: 'saving-content',
                current: totals[type],
                total: totals[type],
            });
            pending[type].resolve([]);
        });

        await initialization;

        expect(store.isImporting()).toBe(false);
        expect(store.isContentInitialized()).toBe(true);
        expect(store.activeImportOperationIds()).toEqual([]);
        expect(store.importPhase()).toBeNull();
        expect(store.importCount()).toBe(0);
        expect(store.itemsToImport()).toBe(0);
    });

    it('cancels active imports and clears stale progress after worker aborts', async () => {
        const pending = {
            live: createDeferred<any[]>(),
            movie: createDeferred<any[]>(),
            series: createDeferred<any[]>(),
        };
        const optionsByType = new Map<
            ContentType,
            { onEvent?: (event: any) => void } | undefined
        >();

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
                options?.onEvent?.({
                    operation: 'save-content',
                    operationId: `${type}-op`,
                    status: 'started',
                    phase: 'saving-content',
                });
                onProgress?.(2);
                options?.onEvent?.({
                    operation: 'save-content',
                    operationId: `${type}-op`,
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

        await store.cancelImport();

        expect(store.isCancellingImport()).toBe(true);
        expect(databaseService.cancelOperation).toHaveBeenCalledTimes(3);
        expect(databaseService.cancelOperation).toHaveBeenCalledWith('live-op');
        expect(databaseService.cancelOperation).toHaveBeenCalledWith('movie-op');
        expect(databaseService.cancelOperation).toHaveBeenCalledWith('series-op');

        (['live', 'movie', 'series'] as ContentType[]).forEach((type) => {
            optionsByType.get(type)?.onEvent?.({
                operation: 'save-content',
                operationId: `${type}-op`,
                status: 'cancelled',
                phase: 'saving-content',
            });
            pending[type].reject(createAbortError());
        });

        await expect(initialization).resolves.toBeUndefined();

        expect(store.isImporting()).toBe(false);
        expect(store.isCancellingImport()).toBe(false);
        expect(store.isContentInitialized()).toBe(false);
        expect(store.activeImportOperationIds()).toEqual([]);
        expect(store.importPhase()).toBeNull();
        expect(store.importCount()).toBe(0);
        expect(store.itemsToImport()).toBe(0);
    });
});
