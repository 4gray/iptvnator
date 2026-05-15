import { eq, inArray } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    checkpointOperation,
    chunkValues,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';

const PLAYLIST_TYPES = {
    XTREAM: 'xtream',
    STALKER: 'stalker',
    M3U_FILE: 'm3u-file',
    M3U_TEXT: 'm3u-text',
    M3U_URL: 'm3u-url',
} as const;

const DEFAULT_BATCH_SIZE = 100;

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

export function parseAppPlaylist(row: schema.Playlist): Record<string, unknown> {
    const payload = parseJsonValue<Record<string, unknown> | null>(
        row.payload,
        null
    );
    const base = payload && typeof payload === 'object' ? payload : {};
    const favorites = parseJsonValue<unknown[]>(row.favorites, []);
    const recentlyViewed = parseJsonValue<unknown[]>(row.recentlyViewed, []);
    const importDate =
        row.importDate ?? row.dateCreated ?? new Date().toISOString();
    const portalUrl =
        row.portalUrl ??
        (row.type === PLAYLIST_TYPES.STALKER ? row.url : null);
    const updateDate =
        row.updateDate ??
        (row.lastUpdated ? new Date(row.lastUpdated).getTime() : undefined);

    return {
        ...base,
        _id: row.id,
        title:
            getStringValue(base.title) ??
            getStringValue(base.name) ??
            row.name,
        count: row.count ?? getNumericValue(base.count) ?? 0,
        importDate: getStringValue(base.importDate) ?? importDate,
        lastUsage:
            row.lastUsage ??
            getStringValue(base.lastUsage) ??
            getStringValue(base.importDate) ??
            importDate,
        favorites,
        recentlyViewed,
        autoRefresh: row.autoRefresh ?? Boolean(base.autoRefresh),
        url:
            row.type === PLAYLIST_TYPES.M3U_URL
                ? row.url ?? getStringValue(base.url)
                : getStringValue(base.url),
        filePath: row.filePath ?? getStringValue(base.filePath),
        userAgent: row.userAgent ?? getStringValue(base.userAgent),
        referrer: row.referrer ?? getStringValue(base.referrer),
        origin: row.origin ?? getStringValue(base.origin),
        updateDate,
        position: row.position ?? getNumericValue(base.position),
        serverUrl: row.serverUrl ?? getStringValue(base.serverUrl),
        username: row.username ?? getStringValue(base.username),
        password: row.password ?? getStringValue(base.password),
        macAddress: row.macAddress ?? getStringValue(base.macAddress),
        portalUrl: portalUrl ?? getStringValue(base.portalUrl),
    };
}

export async function createPlaylist(
    db: AppDatabase,
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
): Promise<{ success: boolean }> {
    await db.insert(schema.playlists).values({
        id: playlist.id,
        name: playlist.name,
        serverUrl: playlist.serverUrl,
        username: playlist.username,
        password: playlist.password,
        macAddress: playlist.macAddress,
        url: playlist.url,
        portalUrl:
            playlist.type === PLAYLIST_TYPES.STALKER ? playlist.url : undefined,
        type: playlist.type as PlaylistType,
    });

    return { success: true };
}

export async function upsertAppPlaylist(
    db: AppDatabase,
    playlist: Record<string, unknown>
): Promise<{ success: boolean }> {
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
}

export async function upsertAppPlaylists(
    db: AppDatabase,
    playlists: Record<string, unknown>[]
): Promise<{ success: boolean; count: number }> {
    if (!Array.isArray(playlists) || playlists.length === 0) {
        return { success: true, count: 0 };
    }

    const rows = playlists
        .map((playlist) => buildPlaylistRow(playlist))
        .filter((row): row is NonNullable<typeof row> => row !== null);

    if (rows.length === 0) {
        return { success: true, count: 0 };
    }

    await db.transaction((tx) => {
        for (const row of rows) {
            tx
                .insert(schema.playlists)
                .values(row)
                .onConflictDoUpdate({
                    target: schema.playlists.id,
                    set: row,
                })
                .run();
        }
    });

    return { success: true, count: rows.length };
}

export async function getAppPlaylists(db: AppDatabase) {
    const rows = await db.select().from(schema.playlists);
    return rows.map((row) => parseAppPlaylist(row));
}

export async function getAppPlaylist(db: AppDatabase, playlistId: string) {
    const rows = await db
        .select()
        .from(schema.playlists)
        .where(eq(schema.playlists.id, playlistId))
        .limit(1);

    return rows[0] ? parseAppPlaylist(rows[0]) : null;
}

export async function getPlaylist(db: AppDatabase, playlistId: string) {
    const result = await db
        .select()
        .from(schema.playlists)
        .where(eq(schema.playlists.id, playlistId))
        .limit(1);

    return result[0] || null;
}

export async function updatePlaylist(
    db: AppDatabase,
    playlistId: string,
    updates: {
        name?: string;
        username?: string;
        password?: string;
        serverUrl?: string;
        lastUpdated?: string;
    }
): Promise<{ success: boolean }> {
    await db
        .update(schema.playlists)
        .set(updates)
        .where(eq(schema.playlists.id, playlistId));

    return { success: true };
}

export async function deletePlaylist(
    db: AppDatabase,
    playlistId: string,
    control?: OperationControl
): Promise<{ success: boolean }> {
    const [favoriteRows, recentlyViewedRows, playbackPositionRows, downloadRows] =
        await Promise.all([
            db
                .select({ id: schema.favorites.id })
                .from(schema.favorites)
                .where(eq(schema.favorites.playlistId, playlistId)),
            db
                .select({ id: schema.recentlyViewed.id })
                .from(schema.recentlyViewed)
                .where(eq(schema.recentlyViewed.playlistId, playlistId)),
            db
                .select({ id: schema.playbackPositions.id })
                .from(schema.playbackPositions)
                .where(eq(schema.playbackPositions.playlistId, playlistId)),
            db
                .select({ id: schema.downloads.id })
                .from(schema.downloads)
                .where(eq(schema.downloads.playlistId, playlistId)),
        ]);

    const categoryRows = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.playlistId, playlistId));
    const categoryIds = categoryRows.map((category) => category.id);
    const contentRows =
        categoryIds.length > 0
            ? await db
                  .select({ id: schema.content.id })
                  .from(schema.content)
                  .where(inArray(schema.content.categoryId, categoryIds))
            : [];

    for (const [phase, ids, column, table] of [
        [
            'deleting-favorites',
            favoriteRows.map((row) => row.id),
            schema.favorites.id,
            schema.favorites,
        ],
        [
            'deleting-recently-viewed',
            recentlyViewedRows.map((row) => row.id),
            schema.recentlyViewed.id,
            schema.recentlyViewed,
        ],
        [
            'deleting-playback-positions',
            playbackPositionRows.map((row) => row.id),
            schema.playbackPositions.id,
            schema.playbackPositions,
        ],
        [
            'deleting-downloads',
            downloadRows.map((row) => row.id),
            schema.downloads.id,
            schema.downloads,
        ],
        [
            'deleting-content',
            contentRows.map((row) => row.id),
            schema.content.id,
            schema.content,
        ],
        [
            'deleting-categories',
            categoryIds,
            schema.categories.id,
            schema.categories,
        ],
    ] as const) {
        let current = 0;
        const total = ids.length;

        for (const chunk of chunkValues(ids, DEFAULT_BATCH_SIZE)) {
            await checkpointOperation(control);
            await db.transaction((tx) => {
                tx.delete(table).where(inArray(column, chunk)).run();
            });
            current += chunk.length;
            await reportOperationProgress(control, {
                phase,
                current,
                total,
                increment: chunk.length,
            });
        }
    }

    await checkpointOperation(control);
    await db.delete(schema.playlists).where(eq(schema.playlists.id, playlistId));
    await reportOperationProgress(control, {
        phase: 'deleting-playlist',
        current: 1,
        total: 1,
        increment: 1,
    });

    return { success: true };
}

export async function getAppState(db: AppDatabase, key: string) {
    const rows = await db
        .select()
        .from(schema.appState)
        .where(eq(schema.appState.key, key))
        .limit(1);

    return rows[0]?.value ?? null;
}

export async function setAppState(
    db: AppDatabase,
    key: string,
    value: string
): Promise<{ success: boolean }> {
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
}

export async function deleteAllPlaylists(
    db: AppDatabase,
    control?: OperationControl
): Promise<{ success: boolean }> {
    const deleteStages = [
        {
            phase: 'deleting-favorites',
            execute: () => db.delete(schema.favorites),
        },
        {
            phase: 'deleting-recently-viewed',
            execute: () => db.delete(schema.recentlyViewed),
        },
        {
            phase: 'deleting-playback-positions',
            execute: () => db.delete(schema.playbackPositions),
        },
        {
            phase: 'deleting-downloads',
            execute: () => db.delete(schema.downloads),
        },
        {
            phase: 'deleting-content',
            execute: () => db.delete(schema.content),
        },
        {
            phase: 'deleting-categories',
            execute: () => db.delete(schema.categories),
        },
        {
            phase: 'deleting-playlists',
            execute: () => db.delete(schema.playlists),
        },
    ] as const;

    let current = 0;
    const total = deleteStages.length;

    for (const stage of deleteStages) {
        await checkpointOperation(control);
        await stage.execute();
        current += 1;
        await reportOperationProgress(control, {
            phase: stage.phase,
            current,
            total,
            increment: 1,
        });
    }

    return { success: true };
}
