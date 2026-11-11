import {
    DEFAULT_TMDB_SETTINGS,
    STORE_KEY,
    type Settings,
} from '@iptvnator/shared/interfaces';
import type { StorageMap } from '@ngx-pwa/local-storage';

export function savedTmdbKey(settings?: Partial<Settings>): string {
    const key = settings?.tmdb?.apiKey;
    return typeof key === 'string' ? key.trim() : '';
}

/** Use the same IndexedDB store as StorageMap so ordinary settings writes serialize with this update. */
export function writeTransferredTmdbKey(
    storage: StorageMap,
    apiKey: string,
    expectedKey: string,
    isCurrent: () => boolean
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const fail = () =>
            reject(new Error('Could not save the TMDB key locally'));
        if (storage.backingEngine !== 'indexedDB') {
            fail();
            return;
        }

        const { database, store } = storage.backingStore;
        const open = indexedDB.open(database);
        open.onerror = fail;
        open.onupgradeneeded = () => open.transaction?.abort();
        open.onsuccess = () => {
            const db = open.result;
            try {
                const tx = db.transaction(store, 'readwrite');
                const records = tx.objectStore(store);
                const read = records.get(STORE_KEY.Settings);
                let saved = false;
                tx.onabort = fail;
                tx.oncomplete = () => resolve(saved);
                read.onsuccess = () => {
                    const current = read.result as
                        Partial<Settings> | undefined;
                    if (!isCurrent() || savedTmdbKey(current) !== expectedKey)
                        return;
                    records.put(
                        {
                            ...current,
                            tmdb: {
                                ...DEFAULT_TMDB_SETTINGS,
                                ...current?.tmdb,
                                apiKey,
                            },
                        },
                        STORE_KEY.Settings
                    );
                    saved = true;
                };
            } catch {
                fail();
            } finally {
                // close() waits for the active transaction and rejects new ones.
                db.close();
            }
        };
    });
}
