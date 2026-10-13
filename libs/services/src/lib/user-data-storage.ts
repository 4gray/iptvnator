import { InjectionToken } from '@angular/core';

/**
 * The slice of the Web Storage API that PWA user-data stores rely on, plus
 * the stored keys where the store can list them, and `ready` where reads
 * show a source's data only once it was read (server mode): it rejects
 * when that read fails.
 */
export type UserDataStorage = Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem'
> & { keys?(): string[]; ready?(): Promise<void> };

/**
 * `localStorage` behind an adapter that reads the global only inside each
 * call: when the browser denies storage access, reading `localStorage`
 * itself throws, and that must happen in the callers' guarded reads and
 * writes, not while Angular constructs the service that injects this.
 */
export function createBrowserUserDataStorage(): UserDataStorage {
    return {
        getItem: (key) => globalThis.localStorage.getItem(key),
        setItem: (key, value) => globalThis.localStorage.setItem(key, value),
        removeItem: (key) => globalThis.localStorage.removeItem(key),
        keys: () => {
            const storage = globalThis.localStorage;
            const keys: string[] = [];
            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (key !== null) {
                    keys.push(key);
                }
            }
            return keys;
        },
    };
}

/** The same lazy adapter over `sessionStorage`: one per tab, kept on reload. */
export function createBrowserSessionStorage(): UserDataStorage {
    return {
        getItem: (key) => globalThis.sessionStorage.getItem(key),
        setItem: (key, value) => globalThis.sessionStorage.setItem(key, value),
        removeItem: (key) => globalThis.sessionStorage.removeItem(key),
    };
}

/**
 * The PWA Xtream user-data maps in USER_DATA_STORAGE, each a JSON object
 * keyed by playlist id. Shared with the playlist backup, which reads and
 * writes them directly.
 */
export const XTREAM_USER_DATA_KEYS = {
    favorites: 'xtream-favorites',
    recentItems: 'xtream-recent-items',
    collectionItems: 'xtream-collection-items',
    playbackPositions: 'xtream-playback-positions',
} as const;

/**
 * Browser persistence for PWA user data such as Xtream favorites, recently
 * viewed items and playback positions. Defaults to `localStorage`; the
 * self-hosted server mode provides a server-synced implementation.
 */
export const USER_DATA_STORAGE = new InjectionToken<UserDataStorage>(
    'USER_DATA_STORAGE',
    { providedIn: 'root', factory: createBrowserUserDataStorage }
);
