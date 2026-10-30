import {
    PARENTAL_LOCK_PIN_KEY,
    PARENTAL_LOCK_STORE_KEY,
} from '@iptvnator/shared/interfaces';
import { sourceProfileStorageKey } from '../source-sync/source-profile-storage';

/** Keep the old browser's protection before a profile can read an absent PIN. */
export function migrateSourceParentalState(): void {
    const pinKey = sourceProfileStorageKey(PARENTAL_LOCK_PIN_KEY);
    if (pinKey === PARENTAL_LOCK_PIN_KEY) return;
    const marker = `${pinKey}:legacy-migrated`;
    if (localStorage.getItem(marker) === '1') return;
    for (const key of [PARENTAL_LOCK_PIN_KEY, PARENTAL_LOCK_STORE_KEY]) {
        const target = sourceProfileStorageKey(key);
        if (localStorage.getItem(target) !== null) continue;
        const previous = localStorage.getItem(key);
        if (previous !== null) localStorage.setItem(target, previous);
    }
    // A failed/partial copy throws and is retried; the storage boundary fails closed.
    localStorage.setItem(marker, '1');
}
