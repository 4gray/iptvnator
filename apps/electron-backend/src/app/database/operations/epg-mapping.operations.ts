import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';

/**
 * Get a single EPG channel mapping by lookup key.
 */
export async function getEpgMapping(
    db: AppDatabase,
    channelKey: string
): Promise<{ id: number; channelKey: string; epgChannelId: string; playlistId: string | null } | null> {
    const rows = await db
        .select({
            id: schema.epgChannelMappings.id,
            channelKey: schema.epgChannelMappings.channelKey,
            epgChannelId: schema.epgChannelMappings.epgChannelId,
            playlistId: schema.epgChannelMappings.playlistId,
        })
        .from(schema.epgChannelMappings)
        .where(eq(schema.epgChannelMappings.channelKey, channelKey))
        .limit(1);

    return rows[0] ?? null;
}

/**
 * Batch lookup of EPG channel mappings for multiple keys.
 * Returns a Map of channelKey → epgChannelId (only for keys that have mappings).
 */
export async function getEpgMappingsBatch(
    db: AppDatabase,
    channelKeys: string[]
): Promise<Map<string, string>> {
    if (channelKeys.length === 0) {
        return new Map();
    }

    const rows = await db
        .select({
            channelKey: schema.epgChannelMappings.channelKey,
            epgChannelId: schema.epgChannelMappings.epgChannelId,
        })
        .from(schema.epgChannelMappings)
        .where(inArray(schema.epgChannelMappings.channelKey, channelKeys));

    const mapping = new Map<string, string>();
    for (const row of rows) {
        mapping.set(row.channelKey, row.epgChannelId);
    }
    return mapping;
}

/**
 * Create or update an EPG channel mapping (upsert).
 */
export async function setEpgMapping(
    db: AppDatabase,
    channelKey: string,
    epgChannelId: string,
    playlistId?: string
): Promise<{ success: boolean }> {
    await db
        .insert(schema.epgChannelMappings)
        .values({
            channelKey,
            epgChannelId,
            playlistId: playlistId ?? null,
        })
        .onConflictDoUpdate({
            target: schema.epgChannelMappings.channelKey,
            set: {
                epgChannelId,
                playlistId: playlistId ?? null,
                updatedAt: sql`(datetime('now'))`,
            },
        });

    return { success: true };
}

/**
 * Remove an EPG channel mapping.
 */
export async function deleteEpgMapping(
    db: AppDatabase,
    channelKey: string
): Promise<{ success: boolean }> {
    await db
        .delete(schema.epgChannelMappings)
        .where(eq(schema.epgChannelMappings.channelKey, channelKey));

    return { success: true };
}

/**
 * Search EPG channels by display name for the mapping dialog.
 */
export async function searchEpgChannels(
    db: AppDatabase,
    searchTerm: string,
    limit = 50
): Promise<Array<{ id: string; displayName: string; iconUrl: string | null }>> {
    const pattern = `%${searchTerm.trim()}%`;

    return db
        .select({
            id: schema.epgChannels.id,
            displayName: schema.epgChannels.displayName,
            iconUrl: schema.epgChannels.iconUrl,
        })
        .from(schema.epgChannels)
        .where(
            or(
                like(schema.epgChannels.displayName, pattern),
                like(schema.epgChannels.id, pattern)
            )
        )
        .orderBy(schema.epgChannels.displayName)
        .limit(limit);
}
