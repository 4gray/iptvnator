import { InjectionToken } from '@angular/core';

/** The slice of the Web Storage API that PWA user-data stores rely on. */
export type UserDataStorage = Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem'
>;

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
