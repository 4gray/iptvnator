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

    it('re-derives the SQLite index from the store on load', async () => {
        await store.load();
        // ensureReadable awaits the reconcile that load() started.
        await store.ensureReadable();

        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'live', [7]);
        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'movies', []);
        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'series', []);
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

    it('re-stamps on the next access when even the rollback write failed', async () => {
        await store.load();
        await store.ensureReadable();
        setCategoryLocks.mockClear();
        setCategoryLocks.mockResolvedValueOnce(false);
        storage.writeLocks
            .mockResolvedValueOnce(true) // the new locks
            .mockResolvedValueOnce(false); // the rollback

        await expect(
            store.setXtreamLocks('pl-1', 'live', [7, 9])
        ).resolves.toBe(false);
        expect(store.lockedXtreamIds('pl-1', 'live')).toEqual([7, 9]);

        await store.ensureReadable();

        expect(setCategoryLocks).toHaveBeenCalledWith('pl-1', 'live', [7, 9]);
    });
});
