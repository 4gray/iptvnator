import { favoritesConsentKey } from './favorites-consent';
export interface FavoritesConsent {
    enabled: boolean;
    generation: string;
    deviceId: string;
}
export function readFavoritesConsent(): FavoritesConsent | null {
    const key = favoritesConsentKey();
    if (!key) return null;
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!value) return null;
    if (
        typeof value.enabled !== 'boolean' ||
        typeof value.generation !== 'string' ||
        !value.generation ||
        typeof value.deviceId !== 'string' ||
        !value.deviceId
    )
        throw new Error('Favorite consent unavailable');
    return value;
}
