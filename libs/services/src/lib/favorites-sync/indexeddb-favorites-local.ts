import { assertActivityToken } from '@iptvnator/shared/interfaces/activity-sync';
import {
    favoriteAddressKey,
    assertFavoriteLocalRecord,
    type FavoriteAddress,
    type FavoriteLocalRecord,
    type FavoriteLocalStore,
    type FavoritePending,
} from '@iptvnator/shared/interfaces/favorites-sync';

const STORE = 'records';

/** Separate opt-in DB; never upgrades, reads or migrates the source/legacy favorite DBs. */
export class IndexedDbFavoriteLocalStore implements FavoriteLocalStore {
    private readonly name: string;

    constructor(private readonly instanceId: string) {
        assertActivityToken(instanceId);
        this.name = `iptvnator-favorites-v1:${instanceId}`;
    }

    read(address: FavoriteAddress): Promise<FavoriteLocalRecord | null> {
        return this.visit(address, 'readonly', (current) => current);
    }

    mutate(
        address: FavoriteAddress,
        change: (current: FavoriteLocalRecord | null) => FavoriteLocalRecord
    ): Promise<FavoriteLocalRecord> {
        return this.visit(address, 'readwrite', (current, store, key) => {
            const next = change(current);
            assertFavoriteLocalRecord(address, next);
            store.put(
                {
                    address,
                    sourceId: address.sourceId,
                    record: next,
                    pendingCount: next.pending.length,
                },
                key
            );
            return next;
        });
    }

    async entries(
        sourceId: string
    ): Promise<{ address: FavoriteAddress; record: FavoriteLocalRecord }[]> {
        const database = await this.open();
        try {
            return await new Promise((resolve, reject) => {
                const tx = database.transaction(STORE, 'readonly');
                const read = tx
                    .objectStore(STORE)
                    .index('source')
                    .getAll(sourceId);
                tx.oncomplete = () =>
                    resolve(
                        read.result.map((row) => ({
                            address: row.address,
                            record: row.record,
                        }))
                    );
                tx.onabort = tx.onerror = () => reject(tx.error);
            });
        } finally {
            database.close();
        }
    }

    async pending(): Promise<FavoritePending[]> {
        const database = await this.open();
        try {
            return await new Promise((resolve, reject) => {
                const transaction = database.transaction(STORE, 'readonly');
                const read = transaction
                    .objectStore(STORE)
                    .index('pending')
                    .getAll(IDBKeyRange.lowerBound(1));
                transaction.oncomplete = () =>
                    resolve(
                        read.result.reduce<FavoritePending[]>(
                            (
                                all: FavoritePending[],
                                row: { record: FavoriteLocalRecord }
                            ) => all.concat(row.record.pending),
                            []
                        )
                    );
                transaction.onabort = transaction.onerror = () =>
                    reject(transaction.error);
            });
        } finally {
            database.close();
        }
    }

    private async visit<T>(
        address: FavoriteAddress,
        mode: IDBTransactionMode,
        visit: (
            current: FavoriteLocalRecord | null,
            store: IDBObjectStore,
            key: string
        ) => T
    ): Promise<T> {
        if (address.instanceId !== this.instanceId) {
            throw new Error('Favorite profile mismatch');
        }
        const key = favoriteAddressKey(address);
        const database = await this.open();
        try {
            return await new Promise<T>((resolve, reject) => {
                const transaction = database.transaction(STORE, mode);
                const store = transaction.objectStore(STORE);
                let result: T;
                let failure: unknown;
                const read = store.get(key);
                read.onsuccess = () => {
                    try {
                        result = visit(read.result?.record ?? null, store, key);
                    } catch (error) {
                        failure = error;
                        transaction.abort();
                    }
                };
                transaction.oncomplete = () => resolve(result);
                transaction.onerror = transaction.onabort = () =>
                    reject(
                        failure ??
                            transaction.error ??
                            new Error('Favorite storage failed')
                    );
            });
        } finally {
            database.close();
        }
    }

    private open(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.name, 1);
            request.onupgradeneeded = () => {
                const store = request.result.createObjectStore(STORE);
                store.createIndex('pending', 'pendingCount');
                store.createIndex('source', 'sourceId');
            };
            request.onerror = () => reject(request.error);
            let blocked = false;
            request.onblocked = () => {
                blocked = true;
                reject(new Error('Favorite storage upgrade blocked'));
            };
            request.onsuccess = () => {
                if (blocked) return request.result.close();
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
        });
    }
}
