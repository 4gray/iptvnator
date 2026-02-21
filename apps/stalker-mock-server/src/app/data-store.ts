import { generatePortalData, GeneratedPortalData } from './data-generator.js';
import { getScenario } from './scenarios.js';

/**
 * Lazy per-MAC in-memory store.
 * Data is generated once on first access for each MAC and cached for the
 * lifetime of the server process. Restart the server to get fresh data.
 */
const portalCache = new Map<string, GeneratedPortalData>();

export function getPortalData(mac: string): GeneratedPortalData {
    const key = mac.toLowerCase();
    if (!portalCache.has(key)) {
        const scenario = getScenario(key);
        console.log(
            `[DataStore] Generating data for MAC ${mac} (scenario: ${scenario.name}, seed: ${scenario.seed})`
        );
        portalCache.set(key, generatePortalData(scenario));
    }
    return portalCache.get(key)!;
}

/** In-memory favorites store per MAC. Resets on server restart. */
const favoritesStore = new Map<string, Set<string>>();

export function getFavorites(mac: string): Set<string> {
    const key = mac.toLowerCase();
    if (!favoritesStore.has(key)) {
        favoritesStore.set(key, new Set());
    }
    return favoritesStore.get(key)!;
}

export function addFavorite(mac: string, itemId: string): void {
    getFavorites(mac).add(itemId);
}

export function removeFavorite(mac: string, itemId: string): void {
    getFavorites(mac).delete(itemId);
}

/** Reset favorites for a MAC (exposed via /reset endpoint). */
export function resetFavorites(mac: string): void {
    favoritesStore.delete(mac.toLowerCase());
}

/** Reset all cached data (exposed via /reset endpoint). */
export function resetAll(): void {
    portalCache.clear();
    favoritesStore.clear();
}
