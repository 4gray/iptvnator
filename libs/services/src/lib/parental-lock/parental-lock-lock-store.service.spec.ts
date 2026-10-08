import { TestBed } from '@angular/core/testing';
import { ParentalLockStore } from '@iptvnator/shared/interfaces';
import { DatabaseService } from '../database-electron.service';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { ParentalLockLockStore } from './parental-lock-lock-store.service';
import { ParentalLockStorageService } from './parental-lock-storage';

describe('ParentalLockLockStore', () => {
    const stored: ParentalLockStore = {
        'pl-1': {
            xtream: [{ categoryType: 'live', xtreamId: 7 }],
            stalker: [],
            m3u: [],
        },
    };
    let storage: { readLocks: jest.Mock; writeLocks: jest.Mock };
    let setCategoryLocks: jest.Mock;
    let store: ParentalLockLockStore;

    beforeEach(() => {
        storage = {
            readLocks: jest.fn(async () => JSON.parse(JSON.stringify(stored))),
            writeLocks: jest.fn(async () => true),
        };
        setCategoryLocks = jest.fn(async () => true);
        TestBed.configureTestingModule({
            providers: [
                ParentalLockLockStore,
                { provide: ParentalLockStorageService, useValue: storage },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource: true },
                },
                { provide: DatabaseService, useValue: { setCategoryLocks } },
            ],
        });
        store = TestBed.inject(ParentalLockLockStore);
    });

    it('is not readable until the initial read has settled', async () => {
        let resolveRead: (locks: ParentalLockStore) => void = () => undefined;
        storage.readLocks.mockReturnValue(
            new Promise<ParentalLockStore>((resolve) => (resolveRead = resolve))
        );
        const load = store.load();

        expect(store.readable()).toBe(false);

        resolveRead({});
        await load;
        expect(store.readable()).toBe(true);
    });

    it('is not readable until the startup re-stamp has completed', async () => {
        let resolveStamp: (ok: boolean) => void = () => undefined;
        setCategoryLocks.mockImplementation(
            () => new Promise<boolean>((resolve) => (resolveStamp = resolve))
        );
        const load = store.load();
        await Promise.resolve();
        await Promise.resolve();

        expect(setCategoryLocks).toHaveBeenCalled();
        expect(store.readable()).toBe(false);

        setCategoryLocks.mockResolvedValue(true);
        resolveStamp(true);
        await load;
        expect(store.readable()).toBe(true);
    });

    it('stays not readable while the startup re-stamp keeps failing', async () => {
        setCategoryLocks.mockResolvedValue(false);
        await store.load();
        expect(store.readable()).toBe(false);
        await expect(store.ensureReadable()).resolves.toBe(false);

        setCategoryLocks.mockResolvedValue(true);
        await expect(store.ensureReadable()).resolves.toBe(true);
        expect(store.readable()).toBe(true);
    });

    it('builds an edit on the recovered store, never on the empty fail-closed one', async () => {
        storage.readLocks.mockResolvedValueOnce(null);
        await store.load();

        await expect(store.setM3uLocks('pl-1', ['Adult'])).resolves.toBe(true);

        expect(storage.writeLocks).toHaveBeenLastCalledWith({
            'pl-1': {
                xtream: [{ categoryType: 'live', xtreamId: 7 }],
                stalker: [],
                m3u: ['Adult'],
            },
        });
    });

    it('re-derives the index from a store recovered after a failed read', async () => {
        storage.readLocks.mockResolvedValueOnce(null);
        await store.load();
        expect(store.readable()).toBe(false);
        expect(setCategoryLocks).not.toHaveBeenCalled();

        await expect(store.ensureReadable()).resolves.toBe(true);

        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'live', [7]);
        expect(store.readable()).toBe(true);
    });

    it('re-derives the SQLite index from the store on load', async () => {
        await store.load();
        // ensureReadable awaits the reconcile that load() started.
        await store.ensureReadable();

        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'live', [7]);
        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'movies', []);
        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'series', []);
    });

    it('clears the index before the last lock leaves the store', async () => {
        await store.load();
        await store.ensureReadable();
        setCategoryLocks.mockClear();
        storage.writeLocks.mockClear();
        const order: string[] = [];
        setCategoryLocks.mockImplementation(async () => {
            order.push('stamp');
            return true;
        });
        storage.writeLocks.mockImplementation(async () => {
            order.push('persist');
            return true;
        });

        await expect(store.setXtreamLocks('pl-1', 'live', [])).resolves.toBe(
            true
        );

        expect(order).toEqual(['stamp', 'persist']);
        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'live', []);
        expect(storage.writeLocks).toHaveBeenLastCalledWith({});
    });

    it('restores the cleared index when saving the emptied store fails', async () => {
        await store.load();
        await store.ensureReadable();
        setCategoryLocks.mockClear();
        storage.writeLocks.mockResolvedValueOnce(false);

        await expect(store.setXtreamLocks('pl-1', 'live', [])).resolves.toBe(
            false
        );

        // Cleared first, then put back from the previous locks.
        expect(setCategoryLocks.mock.calls).toEqual([
            ['pl-1', 'live', []],
            ['pl-1', 'live', [7]],
        ]);
        expect(store.readable()).toBe(true);
    });

    it('publishes a rollback only after every type is re-stamped', async () => {
        await store.load();
        await store.ensureReadable();
        const before = store.revision();
        setCategoryLocks.mockClear();
        const revisionsAtStamp: number[] = [];
        let call = 0;
        setCategoryLocks.mockImplementation(async () => {
            revisionsAtStamp.push(store.revision());
            call += 1;
            // live ok, movies fails, then the rollback re-stamps succeed
            return call !== 2;
        });

        await expect(
            store.replacePlaylistLocks('pl-1', {
                xtream: [{ categoryType: 'movies', xtreamId: 3 }],
                stalker: [],
                m3u: [],
            })
        ).resolves.toBe(false);

        expect(revisionsAtStamp.every((revision) => revision === before)).toBe(
            true
        );
        expect(store.revision()).toBe(before + 1);
    });

    it('does not drop the key when clearing the index fails', async () => {
        await store.load();
        await store.ensureReadable();
        storage.writeLocks.mockClear();
        setCategoryLocks.mockResolvedValue(false);

        await expect(store.setXtreamLocks('pl-1', 'live', [])).resolves.toBe(
            false
        );

        expect(storage.writeLocks).not.toHaveBeenCalled();
        expect(store.lockedXtreamIds('pl-1', 'live')).toEqual([7]);
    });

    it('publishes the revision only after every type is stamped', async () => {
        await store.load();
        await store.ensureReadable();
        const before = store.revision();
        let resolveStamp: (ok: boolean) => void = () => undefined;
        setCategoryLocks.mockImplementation(
            () => new Promise<boolean>((resolve) => (resolveStamp = resolve))
        );

        const writing = store.replacePlaylistLocks('pl-1', {
            xtream: [{ categoryType: 'movies', xtreamId: 3 }],
            stalker: [],
            m3u: [],
        });
        for (
            let i = 0;
            i < 50 && storage.writeLocks.mock.calls.length === 0;
            i += 1
        ) {
            await Promise.resolve();
        }
        expect(storage.writeLocks).toHaveBeenCalled();
        expect(store.revision()).toBe(before);

        setCategoryLocks.mockResolvedValue(true);
        resolveStamp(true);
        await expect(writing).resolves.toBe(true);
        expect(store.revision()).toBe(before + 1);
    });

    it('serializes overlapping edits so neither overwrites the other', async () => {
        await store.load();
        await store.ensureReadable();
        let releaseFirst: (ok: boolean) => void = () => undefined;
        storage.writeLocks.mockImplementationOnce(
            () => new Promise<boolean>((resolve) => (releaseFirst = resolve))
        );

        const first = store.setM3uLocks('pl-1', ['Adult']);
        const second = store.setStalkerLocks('pl-1', 'itv', ['9']);
        for (let i = 0; i < 20; i += 1) {
            await Promise.resolve();
        }
        expect(storage.writeLocks).toHaveBeenCalledTimes(1);

        releaseFirst(true);
        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
        expect(storage.writeLocks).toHaveBeenLastCalledWith({
            'pl-1': {
                xtream: [{ categoryType: 'live', xtreamId: 7 }],
                stalker: [{ categoryType: 'itv', categoryId: '9' }],
                m3u: ['Adult'],
            },
        });
    });

    it("applies back-to-back single-row edits to each other's result", async () => {
        await store.load();
        await store.ensureReadable();
        let releaseFirst: (ok: boolean) => void = () => undefined;
        storage.writeLocks.mockImplementationOnce(
            () => new Promise<boolean>((resolve) => (releaseFirst = resolve))
        );

        const first = store.setStalkerLocks('pl-1', 'itv', (current) => [
            ...current,
            '1',
        ]);
        const second = store.setStalkerLocks('pl-1', 'itv', (current) => [
            ...current,
            '2',
        ]);
        for (
            let i = 0;
            i < 50 && storage.writeLocks.mock.calls.length === 0;
            i += 1
        ) {
            await Promise.resolve();
        }
        releaseFirst(true);
        await Promise.all([first, second]);

        expect(store.lockedStalkerIds('pl-1', 'itv')).toEqual(['1', '2']);
    });

    it('drops a deleted playlist from the store and empties it on clearAll', async () => {
        await store.load();
        await store.ensureReadable();
        setCategoryLocks.mockClear();

        await expect(store.removePlaylist('missing')).resolves.toBe(true);
        await expect(store.removePlaylist('pl-1')).resolves.toBe(true);
        expect(storage.writeLocks).toHaveBeenLastCalledWith({});
        expect(setCategoryLocks).not.toHaveBeenCalled();
        expect(store.lockedXtreamIds('pl-1', 'live')).toEqual([]);

        await expect(store.clearAll()).resolves.toBe(true);
        expect(storage.writeLocks).toHaveBeenLastCalledWith({});
    });

    it('empties the store now and retries a failed persisted clear', async () => {
        await store.load();
        await store.ensureReadable();
        storage.writeLocks.mockResolvedValueOnce(false);

        await expect(store.clearAll()).resolves.toBe(false);
        expect(store.lockedXtreamIds('pl-1', 'live')).toEqual([]);

        storage.writeLocks.mockClear();
        await expect(store.ensureReadable()).resolves.toBe(true);
        expect(storage.writeLocks).toHaveBeenCalledWith({});
    });

    it('is not readable while a write is re-stamping the index', async () => {
        await store.load();
        await store.ensureReadable();
        const readableAtStamp: boolean[] = [];
        setCategoryLocks.mockImplementation(async () => {
            readableAtStamp.push(store.readable());
            return true;
        });

        await expect(
            store.setXtreamLocks('pl-1', 'live', [7, 9])
        ).resolves.toBe(true);
        await expect(store.setXtreamLocks('pl-1', 'live', [])).resolves.toBe(
            true
        );

        expect(readableAtStamp.length).toBeGreaterThan(0);
        expect(readableAtStamp.every((readable) => !readable)).toBe(true);
        expect(store.readable()).toBe(true);
    });

    it('rolls the store back when the index re-stamp fails', async () => {
        await store.load();
        setCategoryLocks.mockResolvedValue(false);

        await expect(
            store.setXtreamLocks('pl-1', 'live', [7, 9])
        ).resolves.toBe(false);

        expect(store.lockedXtreamIds('pl-1', 'live')).toEqual([7]);
        expect(storage.writeLocks).toHaveBeenLastCalledWith(
            expect.objectContaining({
                'pl-1': expect.objectContaining({
                    xtream: [{ categoryType: 'live', xtreamId: 7 }],
                }),
            })
        );
    });

    it('re-stamps every touched type from the restored store after a partial multi-type failure', async () => {
        await store.load();
        await store.ensureReadable();
        setCategoryLocks.mockClear();
        // live commits, movies fails: the index now carries the NEW live
        // locks while the store is rolled back to the old ones.
        setCategoryLocks
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true)
            .mockResolvedValue(true);

        await expect(
            store.replacePlaylistLocks('pl-1', {
                xtream: [{ categoryType: 'movies', xtreamId: 3 }],
                stalker: [],
                m3u: [],
            })
        ).resolves.toBe(false);

        expect(store.lockedXtreamIds('pl-1', 'live')).toEqual([7]);
        // Rollback re-stamps all three types from the restored store.
        expect(setCategoryLocks.mock.calls.slice(3)).toEqual([
            ['pl-1', 'live', [7]],
            ['pl-1', 'movies', []],
            ['pl-1', 'series', []],
        ]);
        expect(store.readable()).toBe(true);
    });

    it('restores the previous locks on the next access when even the rollback write failed', async () => {
        await store.load();
        await store.ensureReadable();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        setCategoryLocks.mockClear();
        setCategoryLocks.mockResolvedValueOnce(false);
        storage.writeLocks
            .mockResolvedValueOnce(true) // the new locks
            .mockResolvedValueOnce(false); // the rollback

        await expect(
            store.setXtreamLocks('pl-1', 'live', [7, 9])
        ).resolves.toBe(false);
        // The failed edit does not take effect: memory holds the previous
        // locks and the store stays fail-closed until they are persisted.
        expect(store.lockedXtreamIds('pl-1', 'live')).toEqual([7]);
        expect(store.readable()).toBe(false);

        await expect(store.ensureReadable()).resolves.toBe(true);

        expect(storage.writeLocks).toHaveBeenLastCalledWith(
            expect.objectContaining({
                'pl-1': expect.objectContaining({
                    xtream: [{ categoryType: 'live', xtreamId: 7 }],
                }),
            })
        );
        // Re-stamped from the restored locks, not the failed edit.
        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'live', [7]);
        expect(store.readable()).toBe(true);
    });

    it('stays not readable until the store write of a cleared last lock lands', async () => {
        await store.load();
        await store.ensureReadable();
        let finishWrite: (ok: boolean) => void = () => undefined;
        storage.writeLocks.mockImplementationOnce(
            () => new Promise<boolean>((resolve) => (finishWrite = resolve))
        );
        const revision = store.revision();

        const clearing = store.setXtreamLocks('pl-1', 'live', []);
        await waitFor(() => storage.writeLocks.mock.calls.length > 0);
        // The index is already cleared; the store still holds the lock.
        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'live', []);
        expect(store.readable()).toBe(false);
        expect(store.revision()).toBe(revision);

        finishWrite(false);
        await expect(clearing).resolves.toBe(false);
        // Restored from the store, which kept the lock.
        expect(setCategoryLocks).toHaveBeenLastCalledWith('pl-1', 'live', [7]);
        expect(store.readable()).toBe(true);
        expect(store.lockedXtreamIds('pl-1', 'live')).toEqual([7]);
    });
    it('refuses, at commit time, an edit that removes a lock while removal is gated', async () => {
        await store.load();
        await store.ensureReadable();
        let unlocked = true;
        store.setRemovalGate(() => unlocked);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        // An earlier write holds the queue while the app relocks: the edit
        // queued behind it was built unlocked but commits locked.
        let finishFirst: (ok: boolean) => void = () => undefined;
        storage.writeLocks.mockImplementationOnce(
            () => new Promise<boolean>((resolve) => (finishFirst = resolve))
        );
        const adding = store.setM3uLocks('pl-1', ['Adults']);
        const removing = store.setXtreamLocks('pl-1', 'live', []);
        await waitFor(() => storage.writeLocks.mock.calls.length > 0);
        unlocked = false;
        finishFirst(true);

        await expect(adding).resolves.toBe(true);
        await expect(removing).resolves.toBe(false);
        expect(store.lockedXtreamIds('pl-1', 'live')).toEqual([7]);

        // Adding stays allowed while locked; removing again once unlocked.
        await expect(
            store.setXtreamLocks('pl-1', 'live', [7, 9])
        ).resolves.toBe(true);
        await expect(
            store.replacePlaylistLocks('pl-1', {
                xtream: [],
                stalker: [],
                m3u: [],
            })
        ).resolves.toBe(false);
        unlocked = true;
        await expect(store.setM3uLocks('pl-1', [])).resolves.toBe(true);
        expect(store.lockedGroupTitles('pl-1')).toEqual([]);
    });
    it('completes a removal whose write was issued before the app relocked', async () => {
        // The parent authorized the removal; a relock that lands once its
        // write is issued is ordered after it (no post-write rollback, which
        // could itself fail and leave the persisted store diverged).
        storage.readLocks.mockResolvedValue({
            'pl-1': { xtream: [], stalker: [], m3u: ['Adults'] },
        });
        await store.load();
        await store.ensureReadable();
        let unlocked = true;
        store.setRemovalGate(() => unlocked);
        storage.writeLocks.mockImplementationOnce(async () => {
            unlocked = false;
            return true;
        });

        await expect(store.setM3uLocks('pl-1', [])).resolves.toBe(true);

        expect(store.lockedGroupTitles('pl-1')).toEqual([]);
        expect(storage.writeLocks).toHaveBeenCalledTimes(1);
        expect(store.readable()).toBe(true);
    });
    it('does not re-stamp an in-flight write from the uncommitted store', async () => {
        await store.load();
        await store.ensureReadable();
        setCategoryLocks.mockClear();
        let finishWrite: (ok: boolean) => void = () => undefined;
        storage.writeLocks.mockImplementationOnce(
            () => new Promise<boolean>((resolve) => (finishWrite = resolve))
        );

        const clearing = store.setXtreamLocks('pl-1', 'live', []);
        await waitFor(() => storage.writeLocks.mock.calls.length > 0);
        // A PIN prompt or backup reaches ensureReadable() beside the write.
        await expect(store.ensureReadable()).resolves.toBe(false);
        finishWrite(true);
        await expect(clearing).resolves.toBe(true);

        // Only the write's own clear: memory still held [7] while it was in
        // flight, and a reconcile stamping that would have re-locked rows
        // the store no longer lists.
        expect(setCategoryLocks.mock.calls).toEqual([['pl-1', 'live', []]]);
        expect(store.readable()).toBe(true);
    });
});

async function waitFor(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 50 && !condition(); i++) {
        await Promise.resolve();
    }
    expect(condition()).toBe(true);
}
