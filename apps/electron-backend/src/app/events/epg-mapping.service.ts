import { getDatabase } from '../database/connection';
import {
    deleteEpgMapping,
    getEpgMapping,
    getEpgMappingsBatch,
    searchEpgChannels,
    setEpgMapping,
} from '../database/operations/epg-mapping.operations';

/**
 * Manual EPG channel mapping resolution and CRUD, called at the IPC boundary
 * before EPG queries run. Every method fails soft: a mapping lookup must never
 * take down an EPG request, it just falls back to the unmapped channel id.
 */

export interface EpgMappingRecord {
    id: number;
    channelKey: string;
    epgChannelId: string;
    playlistId: string | null;
}

export interface EpgChannelSearchResult {
    id: string;
    displayName: string;
    iconUrl: string | null;
}

/**
 * Batch-resolve channel IDs through manual mappings.
 * Returns a Map of original ID → mapped ID (identity when no mapping).
 */
export async function resolveChannelIds(
    channelIds: string[]
): Promise<Map<string, string>> {
    try {
        return await resolveChannelIdsStrict(channelIds);
    } catch {
        return new Map();
    }
}

/**
 * Same lookup, but a database failure rejects. The guide's coverage read
 * uses it: answering "unmapped" for a mapped channel would let the
 * "Only with EPG" filter hide it, whereas a rejection keeps coverage unknown.
 */
export async function resolveChannelIdsStrict(
    channelIds: string[]
): Promise<Map<string, string>> {
    const db = await getDatabase();
    return getEpgMappingsBatch(db, channelIds);
}

/**
 * Run a batch query against mapping-resolved channel IDs and remap the results
 * back onto the original request keys the renderer asked for.
 */
export async function queryByResolvedChannelIds<T>(
    channelIds: string[],
    query: (resolvedIds: string[]) => Promise<Record<string, T | null>>
): Promise<Record<string, T | null>> {
    const resolvedMap = await resolveChannelIds(channelIds);
    const resolvedIds = channelIds.map((id) => resolvedMap.get(id) ?? id);
    const results = await query(resolvedIds);

    const remapped: Record<string, T | null> = {};
    for (const originalId of channelIds) {
        const resolvedId = resolvedMap.get(originalId) ?? originalId;
        remapped[originalId] = results[resolvedId] ?? null;
    }
    return remapped;
}

export async function handleGetEpgMapping(
    channelKey: string
): Promise<EpgMappingRecord | null> {
    try {
        const db = await getDatabase();
        return await getEpgMapping(db, channelKey);
    } catch {
        return null;
    }
}

export async function handleGetEpgMappingsBatch(
    channelKeys: string[]
): Promise<Record<string, string>> {
    if (!Array.isArray(channelKeys) || channelKeys.length === 0) {
        return {};
    }

    try {
        const db = await getDatabase();
        const mappings = await getEpgMappingsBatch(db, channelKeys);
        return Object.fromEntries(mappings);
    } catch {
        return {};
    }
}

export async function handleSetEpgMapping(
    channelKey: string,
    epgChannelId: string,
    playlistId?: string
): Promise<{ success: boolean }> {
    try {
        const db = await getDatabase();
        return await setEpgMapping(db, channelKey, epgChannelId, playlistId);
    } catch {
        return { success: false };
    }
}

export async function handleDeleteEpgMapping(
    channelKey: string
): Promise<{ success: boolean }> {
    try {
        const db = await getDatabase();
        return await deleteEpgMapping(db, channelKey);
    } catch {
        return { success: false };
    }
}

export async function handleSearchEpgChannels(
    searchTerm: string,
    limit?: number
): Promise<EpgChannelSearchResult[]> {
    if (!searchTerm?.trim()) {
        return [];
    }

    try {
        const db = await getDatabase();
        return await searchEpgChannels(db, searchTerm, limit);
    } catch {
        return [];
    }
}
