import { InjectionToken } from '@angular/core';

/** The slice of the Web Storage API that PWA user-data stores rely on. */
export type UserDataStorage = Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem'
>;

/**
 * Browser persistence for PWA user data such as Xtream favorites, recently
 * viewed items and playback positions. Defaults to `localStorage`; the
 * self-hosted server mode provides a server-synced implementation.
 */
export const USER_DATA_STORAGE = new InjectionToken<UserDataStorage>(
    'USER_DATA_STORAGE',
    { providedIn: 'root', factory: () => globalThis.localStorage }
);
