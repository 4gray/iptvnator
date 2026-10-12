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

/** The same lazy adapter over `sessionStorage`: one per tab, kept on reload. */
export function createBrowserSessionStorage(): UserDataStorage {
    return {
        getItem: (key) => globalThis.sessionStorage.getItem(key),
        setItem: (key, value) => globalThis.sessionStorage.setItem(key, value),
        removeItem: (key) => globalThis.sessionStorage.removeItem(key),
    };
}

/**
 * Browser persistence for PWA user data such as Xtream favorites, recently
 * viewed items and playback positions. Defaults to `localStorage`; the
 * self-hosted server mode provides a server-synced implementation.
 */
export const USER_DATA_STORAGE = new InjectionToken<UserDataStorage>(
    'USER_DATA_STORAGE',
    { providedIn: 'root', factory: createBrowserUserDataStorage }
);
