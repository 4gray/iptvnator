import { collectionConsentKey } from '@iptvnator/services/history-events';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
export function favoritesConsentKey(): string | null {
    return collectionConsentKey(sourceConnection()?.instanceId, 'favorites');
}
function preference(): { enabled?: boolean } | null {
    try {
        const key = favoritesConsentKey();
        return key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
    } catch {
        return null;
    }
}
export const favoritesEnabled = () => preference()?.enabled === true;
/** A disabled profile retains local sidecars without authorizing network requests. */
export const favoritesProfileUsed = () =>
    typeof preference()?.enabled === 'boolean';
