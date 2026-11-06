import {
    Injector,
    runInInjectionContext,
    type DestroyableInjector,
} from '@angular/core';
import {
    DatabaseService,
    type DbOperationEvent,
} from './database-electron.service';
import { PlaylistStorageBackend } from './playlist-storage-backend';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });
    return { promise, resolve, reject };
}

describe('DatabaseService operation lifecycle', () => {
    const originalBridge = Object.getOwnPropertyDescriptor(window, 'electron');
    let service: DatabaseService;
    let injector: DestroyableInjector;
    let listeners: Set<(event: DbOperationEvent) => void>;
    let unsubscribe: jest.Mock[];
    let bridge: ReturnType<typeof createBridge>;

    function createBridge() {
        return {
            onDbOperationEvent: jest.fn(
                (listener: (event: DbOperationEvent) => void) => {
                    listeners.add(listener);
                    const remove = jest.fn(() => listeners.delete(listener));
                    unsubscribe.push(remove);
                    return remove;
                }
            ),
            dbSaveContent: jest.fn().mockResolvedValue({ count: 0 }),
            dbDeletePlaylist: jest.fn().mockResolvedValue({ success: true }),
            dbDeleteXtreamContent: jest.fn(),
            dbRestoreXtreamUserData: jest
                .fn()
                .mockResolvedValue({ success: true }),
            dbCancelOperation: jest.fn().mockResolvedValue({ success: true }),
            onDbSaveContentProgress: jest.fn(),
            removeDbSaveContentProgress: jest.fn(),
        };
    }

    function emit(event: DbOperationEvent): void {
        for (const listener of listeners) listener(event);
    }

    beforeEach(() => {
        listeners = new Set();
        unsubscribe = [];
        bridge = createBridge();
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: bridge,
        });
        injector = Injector.create({
            providers: [
                {
                    provide: PlaylistStorageBackend,
                    useValue: { kind: () => 'electron' },
                },
            ],
        });
        service = runInInjectionContext(injector, () => new DatabaseService());
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        injector.destroy();
        jest.restoreAllMocks();
        if (originalBridge)
            Object.defineProperty(window, 'electron', originalBridge);
        else Reflect.deleteProperty(window, 'electron');
    });

    it('isolates concurrent imports by operation ID and operation name until each settles', async () => {
        const first = deferred<{ count: number }>();
        const second = deferred<{ count: number }>();
        bridge.dbSaveContent
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const firstProgress = jest.fn();
        const secondProgress = jest.fn();
        const firstEvent = jest.fn();
        const firstRequest = service.saveXtreamContent(
            'one',
            [],
            'movie',
            firstProgress,
            {
                operationId: 'import-one',
                onEvent: firstEvent,
            }
        );
        const secondRequest = service.saveXtreamContent(
            'two',
            [],
            'series',
            secondProgress,
            {
                operationId: 'import-two',
            }
        );

        emit({
            operationId: 'import-one',
            operation: 'delete-playlist',
            status: 'progress',
            increment: 99,
        });
        emit({
            operationId: 'unrelated',
            operation: 'save-content',
            status: 'progress',
            increment: 99,
        });
        expect(firstProgress).not.toHaveBeenCalled();
        expect(firstEvent).not.toHaveBeenCalled();
        expect(secondProgress).not.toHaveBeenCalled();

        const progress: DbOperationEvent = {
            operationId: 'import-one',
            operation: 'save-content',
            status: 'progress',
            current: 10,
            increment: 2,
        };
        emit(progress);
        emit({ ...progress, operationId: 'import-two', increment: 3 });
        expect(firstProgress.mock.calls).toEqual([[2]]);
        expect(secondProgress.mock.calls).toEqual([[3]]);
        expect(firstEvent).toHaveBeenCalledWith(progress);
        expect(bridge.dbSaveContent.mock.calls).toEqual([
            ['one', [], 'movie', 'import-one'],
            ['two', [], 'series', 'import-two'],
        ]);
        expect(bridge.onDbSaveContentProgress).not.toHaveBeenCalled();

        first.resolve({ count: 10 });
        await expect(firstRequest).resolves.toBe(10);
        expect(unsubscribe[0]).toHaveBeenCalledTimes(1);
        expect(unsubscribe[1]).not.toHaveBeenCalled();
        emit(progress);
        emit({ ...progress, operationId: 'import-two', increment: 4 });
        expect(firstProgress.mock.calls).toEqual([[2]]);
        expect(secondProgress.mock.calls).toEqual([[3], [4]]);
        second.resolve({ count: 20 });
        await expect(secondRequest).resolves.toBe(20);
        expect(listeners.size).toBe(0);
        expect(unsubscribe[1]).toHaveBeenCalledTimes(1);
    });

    it.each(['Error', 'AbortError'])(
        'propagates %s from an import and releases its listener',
        async (name) => {
            const error = Object.assign(new Error('synthetic import failure'), {
                name,
            });
            bridge.dbSaveContent.mockRejectedValue(error);
            await expect(
                service.saveXtreamContent('one', [], 'live', jest.fn())
            ).rejects.toBe(error);
            expect(unsubscribe[0]).toHaveBeenCalledTimes(1);
            expect(listeners.size).toBe(0);
            expect(console.error).toHaveBeenCalledTimes(
                name === 'AbortError' ? 0 : 1
            );
        }
    );

    it('keeps the operation subscribed after a cancel acknowledgement until the import rejects', async () => {
        const pending = deferred<{ count: number }>();
        bridge.dbSaveContent.mockReturnValue(pending.promise);
        const onEvent = jest.fn();
        const request = service.saveXtreamContent(
            'one',
            [],
            'movie',
            undefined,
            {
                operationId: 'cancel-me',
                onEvent,
            }
        );
        await expect(service.cancelOperation('cancel-me')).resolves.toBe(true);
        expect(bridge.dbCancelOperation).toHaveBeenCalledWith('cancel-me');
        expect(unsubscribe[0]).not.toHaveBeenCalled();
        const terminal: DbOperationEvent = {
            operationId: 'cancel-me',
            operation: 'save-content',
            status: 'cancelled',
        };
        emit(terminal);
        expect(onEvent).toHaveBeenCalledWith(terminal);
        const error = Object.assign(new Error('cancelled'), {
            name: 'AbortError',
        });
        const rejected = expect(request).rejects.toBe(error);
        pending.reject(error);
        await rejected;
        expect(listeners.size).toBe(0);
        expect(unsubscribe[0]).toHaveBeenCalledTimes(1);
    });

    it.each(['resolve', 'reject'] as const)(
        'cleans up legacy progress after the import %s path',
        async (outcome) => {
            Reflect.deleteProperty(bridge, 'onDbOperationEvent');
            const pending = deferred<{ count: number }>();
            bridge.dbSaveContent.mockReturnValue(pending.promise);
            const progress = jest.fn();
            const request = service.saveXtreamContent(
                'one',
                [],
                'movie',
                progress
            );
            expect(bridge.onDbSaveContentProgress).toHaveBeenCalledWith(
                progress
            );
            expect(bridge.removeDbSaveContentProgress).not.toHaveBeenCalled();
            if (outcome === 'resolve') {
                pending.resolve({ count: 7 });
                await expect(request).resolves.toBe(7);
            } else {
                const error = new Error('legacy bridge failed');
                const rejected = expect(request).rejects.toBe(error);
                pending.reject(error);
                await rejected;
            }
            expect(bridge.removeDbSaveContentProgress).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['Error', 'AbortError'])(
        'reports a failed deletion as false after %s and releases its listener',
        async (name) => {
            const error = Object.assign(new Error('deletion interrupted'), {
                name,
            });
            bridge.dbDeletePlaylist.mockRejectedValue(error);
            await expect(
                service.deletePlaylist('one', {
                    operationId: 'delete-one',
                    onEvent: jest.fn(),
                })
            ).resolves.toBe(false);
            expect(bridge.dbDeletePlaylist).toHaveBeenCalledWith(
                'one',
                'delete-one'
            );
            expect(listeners.size).toBe(0);
            expect(unsubscribe[0]).toHaveBeenCalledTimes(1);
            expect(console.error).toHaveBeenCalledTimes(
                name === 'AbortError' ? 0 : 1
            );
        }
    );

    it('returns the retained user data from a catalog refresh without dropping any collection', async () => {
        const snapshot = {
            success: true,
            favorites: [{ xtreamId: 7, contentType: 'movie' as const }],
            recentlyViewed: [
                {
                    xtreamId: 8,
                    contentType: 'series' as const,
                    viewedAt: '2026-01-01',
                },
            ],
            hiddenCategories: [
                { xtreamId: 9, categoryType: 'movies' as const },
            ],
        };
        bridge.dbDeleteXtreamContent.mockResolvedValue(snapshot);
        await expect(
            service.deleteXtreamPlaylistContent('one', {
                operationId: 'refresh-one',
                onEvent: jest.fn(),
            })
        ).resolves.toBe(snapshot);
        expect(bridge.dbDeleteXtreamContent).toHaveBeenCalledWith(
            'one',
            'refresh-one',
            undefined
        );
        expect(listeners.size).toBe(0);
        expect(unsubscribe[0]).toHaveBeenCalledTimes(1);
    });

    it('preserves the restore payload and propagates failure without leaking its subscription', async () => {
        const favorites = [{ xtreamId: 7, contentType: 'movie' as const }];
        const recentlyViewed = [
            {
                xtreamId: 8,
                contentType: 'series' as const,
                viewedAt: '2026-01-01',
            },
        ];
        const error = new Error('restore failed');
        bridge.dbRestoreXtreamUserData.mockRejectedValue(error);
        await expect(
            service.restoreXtreamUserData('one', favorites, recentlyViewed, {
                operationId: 'restore-one',
                onEvent: jest.fn(),
            })
        ).rejects.toBe(error);
        expect(bridge.dbRestoreXtreamUserData).toHaveBeenCalledWith(
            'one',
            favorites,
            recentlyViewed,
            'restore-one'
        );
        expect(listeners.size).toBe(0);
        expect(unsubscribe[0]).toHaveBeenCalledTimes(1);
        expect(favorites).toEqual([{ xtreamId: 7, contentType: 'movie' }]);
        expect(recentlyViewed).toEqual([
            { xtreamId: 8, contentType: 'series', viewedAt: '2026-01-01' },
        ]);
    });

    it('checks cancellation support for the specific bridge method', async () => {
        Reflect.deleteProperty(bridge, 'dbCancelOperation');
        expect(service.supportsDbOperationCancellation()).toBe(false);
        expect(service.supportsDbOperationEvents()).toBe(true);
        await expect(service.cancelOperation('unknown')).resolves.toBe(false);
    });

    it('does not send empty cancellation IDs or report rejected cancellation as success', async () => {
        await expect(service.cancelOperation('')).resolves.toBe(false);
        expect(bridge.dbCancelOperation).not.toHaveBeenCalled();
        bridge.dbCancelOperation.mockResolvedValueOnce({ success: false });
        await expect(service.cancelOperation('finished')).resolves.toBe(false);
        bridge.dbCancelOperation.mockRejectedValueOnce(
            new Error('bridge unavailable')
        );
        await expect(service.cancelOperation('pending')).resolves.toBe(false);
    });
});
