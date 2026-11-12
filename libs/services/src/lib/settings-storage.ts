import { type StorageMap } from '@ngx-pwa/local-storage';
import {
    DEFAULT_TMDB_SETTINGS,
    STORE_KEY,
    type Settings,
} from '@iptvnator/shared/interfaces';
import { notifyTmdbKeyChange } from './settings-store.defaults';

export async function writeSettings(
    storage: StorageMap,
    settings: Settings,
    preserveTmdbKey: boolean
): Promise<string> {
    const saved = await updateSettingsRecord(storage, (current) => {
        if (!preserveTmdbKey) return settings;
        const key = current?.tmdb?.apiKey;
        return {
            ...settings,
            tmdb: {
                ...DEFAULT_TMDB_SETTINGS,
                ...settings.tmdb,
                apiKey: typeof key === 'string' ? key : '',
            },
        };
    });
    return saved?.tmdb?.apiKey ?? '';
}

export async function writeTransferredTmdbKey(
    storage: StorageMap,
    apiKey: string,
    expectedKey: string,
    isCurrent: () => boolean
): Promise<boolean> {
    const saved = await updateSettingsRecord(storage, (current) => {
        const key = current?.tmdb?.apiKey;
        if (
            !isCurrent() ||
            (typeof key === 'string' ? key.trim() : '') !== expectedKey
        )
            return;
        return {
            ...current,
            tmdb: { ...DEFAULT_TMDB_SETTINGS, ...current?.tmdb, apiKey },
        };
    });
    if (saved) notifyTmdbKeyChange();
    return !!saved;
}

/** Read and update the StorageMap record in one IndexedDB transaction. */
function updateSettingsRecord(
    storage: StorageMap,
    update: (current?: Partial<Settings>) => Partial<Settings> | undefined
): Promise<Partial<Settings> | undefined> {
    return new Promise((resolve, reject) => {
        const fail = () => reject(new Error('Could not save settings locally'));
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
                let saved: Partial<Settings> | undefined;
                tx.onabort = fail;
                tx.oncomplete = () => resolve(saved);
                read.onsuccess = () => {
                    saved = update(
                        read.result as Partial<Settings> | undefined
                    );
                    if (saved) records.put(saved, STORE_KEY.Settings);
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
