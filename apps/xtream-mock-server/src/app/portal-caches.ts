import type { PortalData } from './data-store.js';
import type { RawVodDetails } from './generators/vod.generator.js';
import type { RawSeriesInfo } from './generators/series.generator.js';
import { clearAccountDetails, portalIdentityKey } from './account-identity.js';

export const portalCache = new Map<string, PortalData>();
export const vodDetailsCache = new Map<string, RawVodDetails>();
export const seriesInfoCache = new Map<string, RawSeriesInfo>();

/** Evict only this account, including eagerly generated series details. */
export function resetAccount(username: string, password: string): void {
    const key = portalIdentityKey(username, password);
    portalCache.delete(key);
    clearAccountDetails(vodDetailsCache, key);
    clearAccountDetails(seriesInfoCache, key);
}

export function resetAll(): void {
    portalCache.clear();
    vodDetailsCache.clear();
    seriesInfoCache.clear();
}

/** Test-only cache sizes; never exposes credential-bearing keys or fixture data. */
export function getDetailCacheCardinalityForTesting(): Readonly<{
    vodDetails: number;
    seriesInfo: number;
}> {
    return {
        vodDetails: vodDetailsCache.size,
        seriesInfo: seriesInfoCache.size,
    };
}
