import { DbStores, type Playlist } from '@iptvnator/shared/interfaces';

/** Commit against the current row in one transaction, including without Web Locks. */
export function mutateIndexedDbPlaylist(
    profile: string,
    id: string,
    mutate: (current: Playlist | null) => Playlist
): Promise<Playlist> {
    return visitPlaylist(profile, id, (store, current) => {
        const next = mutate(current);
        store.put(next);
        return next;
    });
}

/** The revision check, durable marker and deletion share the write transaction. */
export function pruneIndexedDbPlaylist(
    profile: string,
    id: string,
    revision: string | undefined,
    beforeDelete: () => void
): Promise<boolean> {
    return visitPlaylist(profile, id, (store, current) => {
        if (!current || current.sourceSyncRevision !== revision) return false;
        beforeDelete();
        store.delete(id);
        return true;
    });
}

function visitPlaylist<T>(
    profile: string,
    id: string,
    visit: (store: IDBObjectStore, current: Playlist | null) => T
): Promise<T> {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(profile);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const database = open.result;
            let transaction: IDBTransaction;
            try {
                transaction = database.transaction(
                    DbStores.Playlists,
                    'readwrite'
                );
            } catch (error) {
                database.close();
                reject(error);
                return;
            }
            const store = transaction.objectStore(DbStores.Playlists);
            let next: T;
            let failure: unknown;
            const read = store.get(id);
            read.onsuccess = () => {
                try {
                    next = visit(store, read.result ?? null);
                } catch (error) {
                    failure = error;
                    transaction.abort();
                }
            };
            transaction.oncomplete = () => {
                database.close();
                resolve(next);
            };
            transaction.onabort = transaction.onerror = () => {
                database.close();
                reject(
                    failure ??
                        transaction.error ??
                        new Error('SOURCE_SYNC.REQUEST_FAILED')
                );
            };
        };
    });
}
