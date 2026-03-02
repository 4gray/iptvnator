/**
 * Playlist IPC event handlers
 * CRUD operations for playlists
 */

import { eq } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';

const PLAYLIST_TYPES = {
    XTREAM: 'xtream',
    STALKER: 'stalker',
    M3U_FILE: 'm3u-file',
    M3U_TEXT: 'm3u-text',
    M3U_URL: 'm3u-url',
} as const;

type PlaylistType = (typeof PLAYLIST_TYPES)[keyof typeof PLAYLIST_TYPES];
const PLAYLIST_TYPE_VALUES = new Set<PlaylistType>(
    Object.values(PLAYLIST_TYPES)
);

function getStringValue(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function getNumericValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value) as T;
    } catch (error) {
        console.warn('Failed to parse JSON value from DB:', error);
        return fallback;
    }
}

function inferPlaylistType(playlist: Record<string, unknown>): PlaylistType {
    const explicitType = getStringValue(playlist.type);
    if (
        explicitType &&
        PLAYLIST_TYPE_VALUES.has(explicitType as PlaylistType)
    ) {
        return explicitType as PlaylistType;
    }

    if (getStringValue(playlist.serverUrl)) {
        return PLAYLIST_TYPES.XTREAM;
    }

    if (getStringValue(playlist.macAddress)) {
        return PLAYLIST_TYPES.STALKER;
    }

    if (getStringValue(playlist.filePath)) {
        return PLAYLIST_TYPES.M3U_FILE;
    }

    if (getStringValue(playlist.url)) {
        return PLAYLIST_TYPES.M3U_URL;
    }

    return PLAYLIST_TYPES.M3U_TEXT;
}

function buildPlaylistRow(
    playlist: Record<string, unknown>
): schema.NewPlaylist | null {
    const id = getStringValue(playlist._id) ?? getStringValue(playlist.id);
    if (!id) {
        return null;
    }

    const type = inferPlaylistType(playlist);
    const portalUrl = getStringValue(playlist.portalUrl);
    const url = getStringValue(playlist.url);
    const nowIso = new Date().toISOString();
    const updateDate = getNumericValue(playlist.updateDate);

    return {
        id,
        name:
            getStringValue(playlist.title) ??
            getStringValue(playlist.name) ??
            id,
        serverUrl: getStringValue(playlist.serverUrl),
        username: getStringValue(playlist.username),
        password: getStringValue(playlist.password),
        lastUpdated:
            typeof updateDate === 'number'
                ? new Date(updateDate).toISOString()
                : getStringValue(playlist.lastUpdated),
        type,
        userAgent: getStringValue(playlist.userAgent),
        origin: getStringValue(playlist.origin),
        referrer: getStringValue(playlist.referrer),
        filePath: getStringValue(playlist.filePath),
        autoRefresh: Boolean(playlist.autoRefresh),
        macAddress: getStringValue(playlist.macAddress),
        // Keep historical semantics: stalker portal URL has been stored in "url"
        url: type === PLAYLIST_TYPES.STALKER ? (portalUrl ?? url) : url,
        portalUrl,
        count: getNumericValue(playlist.count),
        importDate: getStringValue(playlist.importDate),
        updateDate,
        position: getNumericValue(playlist.position),
        favorites:
            playlist.favorites !== undefined
                ? JSON.stringify(playlist.favorites)
                : undefined,
        recentlyViewed:
            playlist.recentlyViewed !== undefined
                ? JSON.stringify(playlist.recentlyViewed)
                : undefined,
        payload: JSON.stringify(playlist),
        lastUsage: getStringValue(playlist.lastUsage) ?? nowIso,
    };
}

function parseAppPlaylist(row: schema.Playlist): Record<string, unknown> {
    const payload = parseJsonValue<Record<string, unknown> | null>(
        row.payload,
        null
    );
    if (payload && typeof payload === 'object') {
        return {
            ...payload,
            _id:
                getStringValue(payload._id) ??
                getStringValue(payload.id) ??
                row.id,
            title:
                getStringValue(payload.title) ??
                getStringValue(payload.name) ??
                row.name,
        };
    }

    const favorites = parseJsonValue<unknown[]>(row.favorites, []);
    const recentlyViewed = parseJsonValue<unknown[]>(row.recentlyViewed, []);
    const importDate = row.importDate ?? row.dateCreated ?? new Date().toISOString();
    const portalUrl =
        row.portalUrl ??
        (row.type === PLAYLIST_TYPES.STALKER ? row.url : null);

    return {
        _id: row.id,
        title: row.name,
        count: row.count ?? 0,
        importDate,
        lastUsage: row.lastUsage ?? importDate,
        favorites,
        recentlyViewed,
        autoRefresh: row.autoRefresh ?? false,
        url: row.type === PLAYLIST_TYPES.M3U_URL ? row.url : undefined,
        filePath: row.filePath ?? undefined,
        userAgent: row.userAgent ?? undefined,
        referrer: row.referrer ?? undefined,
        origin: row.origin ?? undefined,
        updateDate:
            row.updateDate ??
            (row.lastUpdated ? new Date(row.lastUpdated).getTime() : undefined),
        position: row.position ?? undefined,
        serverUrl: row.serverUrl ?? undefined,
        username: row.username ?? undefined,
        password: row.password ?? undefined,
        macAddress: row.macAddress ?? undefined,
        portalUrl: portalUrl ?? undefined,
    };
}

/**
 * Create a new playlist
 */
ipcMain.handle(
    'DB_CREATE_PLAYLIST',
    async (
        event,
        playlist: {
            id: string;
            name: string;
            serverUrl?: string;
            username?: string;
            password?: string;
            macAddress?: string;
            url?: string;
            type: string;
        }
    ) => {
        try {
            const db = await getDatabase();
            await db.insert(schema.playlists).values({
                id: playlist.id,
                name: playlist.name,
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
                macAddress: playlist.macAddress,
                url: playlist.url,
                portalUrl:
                    playlist.type === PLAYLIST_TYPES.STALKER
                        ? playlist.url
                        : undefined,
                // enforce supported types
                type: playlist.type as PlaylistType,
            });
            return { success: true };
        } catch (error) {
            console.error('Error creating playlist:', error);
            throw error;
        }
    }
);

/**
 * Upsert a full app playlist object (meta + optional content payload)
 */
ipcMain.handle(
    'DB_UPSERT_APP_PLAYLIST',
    async (event, playlist: Record<string, unknown>) => {
        try {
            const db = await getDatabase();
            const row = buildPlaylistRow(playlist);
            if (!row) {
                throw new Error('Playlist ID is required for upsert');
            }

            await db
                .insert(schema.playlists)
                .values(row)
                .onConflictDoUpdate({
                    target: schema.playlists.id,
                    set: row,
                });

            return { success: true };
        } catch (error) {
            console.error('Error upserting app playlist:', error);
            throw error;
        }
    }
);

/**
 * Bulk upsert full app playlist objects
 */
ipcMain.handle(
    'DB_UPSERT_APP_PLAYLISTS',
    async (event, playlists: Record<string, unknown>[]) => {
        try {
            if (!Array.isArray(playlists) || playlists.length === 0) {
                return { success: true, count: 0 };
            }

            const db = await getDatabase();
            let count = 0;

            for (const playlist of playlists) {
                const row = buildPlaylistRow(playlist);
                if (!row) {
                    continue;
                }

                await db
                    .insert(schema.playlists)
                    .values(row)
                    .onConflictDoUpdate({
                        target: schema.playlists.id,
                        set: row,
                    });

                count += 1;
            }

            return { success: true, count };
        } catch (error) {
            console.error('Error bulk upserting app playlists:', error);
            throw error;
        }
    }
);

/**
 * Get all app playlists as playlist objects (parsed from payload)
 */
ipcMain.handle('DB_GET_APP_PLAYLISTS', async () => {
    try {
        const db = await getDatabase();
        const rows = await db.select().from(schema.playlists);
        return rows.map((row) => parseAppPlaylist(row));
    } catch (error) {
        console.error('Error getting app playlists:', error);
        throw error;
    }
});

/**
 * Get app playlist by ID as playlist object
 */
ipcMain.handle('DB_GET_APP_PLAYLIST', async (event, playlistId: string) => {
    try {
        const db = await getDatabase();
        const rows = await db
            .select()
            .from(schema.playlists)
            .where(eq(schema.playlists.id, playlistId))
            .limit(1);

        return rows[0] ? parseAppPlaylist(rows[0]) : null;
    } catch (error) {
        console.error('Error getting app playlist:', error);
        throw error;
    }
});

/**
 * Get playlist by ID
 */
ipcMain.handle('DB_GET_PLAYLIST', async (event, playlistId: string) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select()
            .from(schema.playlists)
            .where(eq(schema.playlists.id, playlistId))
            .limit(1);
        return result[0] || null;
    } catch (error) {
        console.error('Error getting playlist:', error);
        throw error;
    }
});

/**
 * Update playlist
 */
ipcMain.handle(
    'DB_UPDATE_PLAYLIST',
    async (
        event,
        playlistId: string,
        updates: {
            name?: string;
            username?: string;
            password?: string;
            serverUrl?: string;
            lastUpdated?: string;
        }
    ) => {
        try {
            const db = await getDatabase();
            await db
                .update(schema.playlists)
                .set(updates)
                .where(eq(schema.playlists.id, playlistId));
            return { success: true };
        } catch (error) {
            console.error('Error updating playlist:', error);
            throw error;
        }
    }
);

/**
 * Delete playlist and all related data
 */
ipcMain.handle('DB_DELETE_PLAYLIST', async (event, playlistId: string) => {
    try {
        const db = await getDatabase();

        // Delete playlist (cascade will handle related data)
        await db
            .delete(schema.playlists)
            .where(eq(schema.playlists.id, playlistId));

        return { success: true };
    } catch (error) {
        console.error('Error deleting playlist:', error);
        throw error;
    }
});

/**
 * Read an app-level state value by key
 */
ipcMain.handle('DB_GET_APP_STATE', async (event, key: string) => {
    try {
        const db = await getDatabase();
        const rows = await db
            .select()
            .from(schema.appState)
            .where(eq(schema.appState.key, key))
            .limit(1);
        return rows[0]?.value ?? null;
    } catch (error) {
        console.error('Error getting app state:', error);
        throw error;
    }
});

/**
 * Upsert an app-level state key/value pair
 */
ipcMain.handle(
    'DB_SET_APP_STATE',
    async (event, key: string, value: string) => {
        try {
            const db = await getDatabase();
            const updatedAt = new Date().toISOString();

            await db
                .insert(schema.appState)
                .values({
                    key,
                    value,
                    updatedAt,
                })
                .onConflictDoUpdate({
                    target: schema.appState.key,
                    set: { value, updatedAt },
                });

            return { success: true };
        } catch (error) {
            console.error('Error setting app state:', error);
            throw error;
        }
    }
);

/**
 * Delete all playlists and related data from SQLite
 */
ipcMain.handle('DB_DELETE_ALL_PLAYLISTS', async () => {
    try {
        const db = await getDatabase();

        // Delete in order respecting foreign key constraints
        // First delete favorites and recently_viewed (they reference content)
        await db.delete(schema.favorites);
        await db.delete(schema.recentlyViewed);

        // Then delete content (references categories)
        await db.delete(schema.content);

        // Then delete categories (references playlists)
        await db.delete(schema.categories);

        // Finally delete playlists
        await db.delete(schema.playlists);

        return { success: true };
    } catch (error) {
        console.error('Error deleting all playlists:', error);
        throw error;
    }
});
