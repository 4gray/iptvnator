import { DbStores, type Playlist } from '@iptvnator/shared/interfaces';

/** Commit against the current row in one transaction, including without Web Locks. */
export function mutateIndexedDbPlaylist(
    profile: string,
    id: string,
    mutate: (current: Playlist | null) => Playlist
): Promise<Playlist> {
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
            let next: Playlist;
            let failure: unknown;
            const read = store.get(id);
            read.onsuccess = () => {
                try {
                    next = mutate(read.result ?? null);
                    store.put(next);
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
