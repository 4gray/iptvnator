import { eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { Channel, M3uFavoriteChannel } from '@iptvnator/shared/interfaces';
import {
    APP_PLAYLIST_GET_PERFORMANCE_PHASE,
    APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE,
    XTREAM_DATABASE_PERFORMANCE_PHASE,
    type AppPlaylistGetPerformancePhase,
    type AppPlaylistUpsertPerformancePhase,
    type PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import {
    type CategoryRowCount,
    countContentRowsByCategory,
    deleteCategoriesWhere,
    deleteContentByCategoryGroups,
    sumCategoryRowCounts,
} from './catalog-deletion';
import {
    checkpointOperation,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';
import type { DatabaseOperationPerformancePhaseCapture } from './performance-phase-capture';

const PLAYLIST_TYPES = {
    XTREAM: 'xtream',
    STALKER: 'stalker',
    M3U_FILE: 'm3u-file',
    M3U_TEXT: 'm3u-text',
    M3U_URL: 'm3u-url',
} as const;

export interface AppPlaylistUpsertPhaseCapture {
    captureAsync: <TResult>(
        phase: AppPlaylistUpsertPerformancePhase,
        execute: () => Promise<TResult>,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => Promise<TResult>;
    captureSync: <TResult>(
        phase: AppPlaylistUpsertPerformancePhase,
        execute: () => TResult,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => TResult;
}

export interface AppPlaylistGetPhaseCapture {
    captureAsync: <TResult>(
        phase: AppPlaylistGetPerformancePhase,
        execute: () => Promise<TResult>,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => Promise<TResult>;
    captureSync: <TResult>(
        phase: AppPlaylistGetPerformancePhase,
        execute: () => TResult,
        metadata?: (result: TResult) => PerformancePhaseMetadata
    ) => TResult;
}

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

function getStringArrayValue(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
}

function getFavoriteChannelMatch(
    channel: Channel,
    favoritePositions: ReadonlyMap<string, number>
): { favoriteId: string; favoriteIndex: number } | null {
    const channelId = String(channel.id ?? '').trim();
    const channelUrl = String(channel.url ?? '').trim();
    const channelIdFavoritePosition = favoritePositions.get(channelId);
    const channelUrlFavoritePosition = favoritePositions.get(channelUrl);

    if (
        channelIdFavoritePosition !== undefined &&
        (channelUrlFavoritePosition === undefined ||
            channelIdFavoritePosition <= channelUrlFavoritePosition)
    ) {
        return {
            favoriteId: channelId,
            favoriteIndex: channelIdFavoritePosition,
        };
    }

    if (channelUrlFavoritePosition !== undefined) {
        return {
            favoriteId: channelUrl,
            favoriteIndex: channelUrlFavoritePosition,
        };
    }

    return null;
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

export function buildPlaylistRow(
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
        epgUrls:
            playlist.epgUrls !== undefined
                ? JSON.stringify(getStringArrayValue(playlist.epgUrls))
                : undefined,
        detectedEpgUrls:
            playlist.detectedEpgUrls !== undefined
                ? JSON.stringify(getStringArrayValue(playlist.detectedEpgUrls))
                : undefined,
        manualEpgUrls:
            playlist.manualEpgUrls !== undefined
                ? JSON.stringify(getStringArrayValue(playlist.manualEpgUrls))
                : undefined,
        disabledEpgUrls:
            playlist.disabledEpgUrls !== undefined
                ? JSON.stringify(getStringArrayValue(playlist.disabledEpgUrls))
                : undefined,
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

function getPlaylistItemCount(
    playlist: Record<string, unknown>
): number | undefined {
    try {
        const value = playlist.playlist;
        if (typeof value !== 'object' || value === null) {
            return undefined;
        }
        const items = Reflect.get(value, 'items');
        return Array.isArray(items) ? items.length : undefined;
    } catch {
        return undefined;
    }
}

export function parseAppPlaylist(
    row: schema.Playlist
): Record<string, unknown> {
    const payload = parseJsonValue<Record<string, unknown> | null>(
        row.payload,
        null
    );
    const base = payload && typeof payload === 'object' ? payload : {};
    const favorites = parseJsonValue<unknown[]>(row.favorites, []);
    const recentlyViewed = parseJsonValue<unknown[]>(row.recentlyViewed, []);
    const epgUrls = getStringArrayValue(
        row.epgUrls ? parseJsonValue<unknown[]>(row.epgUrls, []) : base.epgUrls
    );
    const detectedEpgUrls = getStringArrayValue(
        row.detectedEpgUrls
            ? parseJsonValue<unknown[]>(row.detectedEpgUrls, [])
            : (base.detectedEpgUrls ?? epgUrls)
    );
    const manualEpgUrls = getStringArrayValue(
        row.manualEpgUrls
            ? parseJsonValue<unknown[]>(row.manualEpgUrls, [])
            : base.manualEpgUrls
    );
    const disabledEpgUrls = getStringArrayValue(
        row.disabledEpgUrls
            ? parseJsonValue<unknown[]>(row.disabledEpgUrls, [])
            : base.disabledEpgUrls
    );
    const importDate =
        row.importDate ?? row.dateCreated ?? new Date().toISOString();
    const portalUrl =
        row.portalUrl ?? (row.type === PLAYLIST_TYPES.STALKER ? row.url : null);
    const updateDate =
        row.updateDate ??
        (row.lastUpdated ? new Date(row.lastUpdated).getTime() : undefined);

    return {
        ...base,
        _id: row.id,
        title:
            getStringValue(base.title) ?? getStringValue(base.name) ?? row.name,
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
                ? (row.url ?? getStringValue(base.url))
                : getStringValue(base.url),
        filePath: row.filePath ?? getStringValue(base.filePath),
        epgUrls,
        detectedEpgUrls,
        manualEpgUrls,
        disabledEpgUrls,
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
    playlist: Record<string, unknown>,
    capturePhase?: AppPlaylistUpsertPhaseCapture
): Promise<{ success: boolean }> {
    const row = capturePhase
        ? capturePhase.captureSync(
              APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SERIALIZE_PLAYLIST,
              () => buildPlaylistRow(playlist),
              () => ({
                  itemCount: getPlaylistItemCount(playlist),
              })
          )
        : buildPlaylistRow(playlist);
    if (!row) {
        throw new Error('Playlist ID is required for upsert');
    }

    const write = async () => {
        await db.insert(schema.playlists).values(row).onConflictDoUpdate({
            target: schema.playlists.id,
            set: row,
        });
    };
    if (capturePhase) {
        await capturePhase.captureAsync(
            APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE,
            write,
            () => ({
                itemCount: 1,
            })
        );
    } else {
        await write();
    }

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
            tx.insert(schema.playlists)
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

export async function getAppPlaylistMetas(db: AppDatabase) {
    const rows = await db
        .select({
            id: schema.playlists.id,
            name: schema.playlists.name,
            serverUrl: schema.playlists.serverUrl,
            username: schema.playlists.username,
            password: schema.playlists.password,
            dateCreated: schema.playlists.dateCreated,
            lastUpdated: schema.playlists.lastUpdated,
            type: schema.playlists.type,
            userAgent: schema.playlists.userAgent,
            origin: schema.playlists.origin,
            referrer: schema.playlists.referrer,
            filePath: schema.playlists.filePath,
            epgUrls: schema.playlists.epgUrls,
            detectedEpgUrls: schema.playlists.detectedEpgUrls,
            manualEpgUrls: schema.playlists.manualEpgUrls,
            disabledEpgUrls: schema.playlists.disabledEpgUrls,
            autoRefresh: schema.playlists.autoRefresh,
            macAddress: schema.playlists.macAddress,
            url: schema.playlists.url,
            portalUrl: schema.playlists.portalUrl,
            count: schema.playlists.count,
            importDate: schema.playlists.importDate,
            updateDate: schema.playlists.updateDate,
            position: schema.playlists.position,
            favorites: schema.playlists.favorites,
            recentlyViewed: schema.playlists.recentlyViewed,
            lastUsage: schema.playlists.lastUsage,
        })
        .from(schema.playlists);

    return rows.map((row) =>
        parseAppPlaylist({
            ...row,
            payload: null,
        } as schema.Playlist)
    );
}

export async function getAppPlaylist(
    db: AppDatabase,
    playlistId: string,
    capturePhase?: AppPlaylistGetPhaseCapture
) {
    const read = () =>
        db
            .select()
            .from(schema.playlists)
            .where(eq(schema.playlists.id, playlistId))
            .limit(1);
    const rows = capturePhase
        ? await capturePhase.captureAsync(
              APP_PLAYLIST_GET_PERFORMANCE_PHASE.SQLITE_READ,
              read,
              (value) => ({ itemCount: value.length })
          )
        : await read();
    const deserialize = () => (rows[0] ? parseAppPlaylist(rows[0]) : null);

    return capturePhase
        ? capturePhase.captureSync(
              APP_PLAYLIST_GET_PERFORMANCE_PHASE.DESERIALIZE_PLAYLIST,
              deserialize,
              (value) => ({
                  itemCount: value ? (getPlaylistItemCount(value) ?? 0) : 0,
              })
          )
        : deserialize();
}

export async function getAppPlaylistFavoriteChannels(
    db: AppDatabase,
    playlistId: string
): Promise<M3uFavoriteChannel[]> {
    const rows = await db
        .select({
            id: schema.playlists.id,
            favorites: schema.playlists.favorites,
            payload: schema.playlists.payload,
        })
        .from(schema.playlists)
        .where(eq(schema.playlists.id, playlistId))
        .limit(1);
    const row = rows[0];
    if (!row) {
        return [];
    }

    const favorites = parseJsonValue<unknown[]>(row.favorites, []).filter(
        (favorite): favorite is string =>
            typeof favorite === 'string' && favorite.trim().length > 0
    );
    if (favorites.length === 0) {
        return [];
    }

    const payload = parseJsonValue<{
        playlist?: { items?: Channel[] };
    } | null>(row.payload, null);
    const channels = Array.isArray(payload?.playlist?.items)
        ? payload.playlist.items
        : [];
    if (channels.length === 0) {
        return [];
    }

    const favoritePositions = new Map<string, number>();
    favorites.forEach((favorite, index) => {
        if (!favoritePositions.has(favorite)) {
            favoritePositions.set(favorite, index);
        }
    });

    const resolved: M3uFavoriteChannel[] = [];
    for (const channel of channels) {
        const match = getFavoriteChannelMatch(channel, favoritePositions);
        if (!match) {
            continue;
        }

        resolved.push({
            favoriteId: match.favoriteId,
            favoriteIndex: match.favoriteIndex,
            channel,
        });

        if (resolved.length === favoritePositions.size) {
            break;
        }
    }

    return resolved.sort((a, b) => a.favoriteIndex - b.favoriteIndex);
}

/**
 * The raw row plus the fields the Xtream store needs from the JSON payload:
 * `serverTimezone` has no column, and the store seeds `currentPlaylist`
 * from this read before (or without) the account-info check that learns
 * it (issue #1562).
 */
export async function getPlaylist(db: AppDatabase, playlistId: string) {
    const result = await db
        .select()
        .from(schema.playlists)
        .where(eq(schema.playlists.id, playlistId))
        .limit(1);
    const row = result[0];
    if (!row) {
        return null;
    }

    const serverTimezone = getStringValue(
        parseJsonValue<Record<string, unknown> | null>(row.payload, null)
            ?.serverTimezone
    );
    return serverTimezone ? { ...row, serverTimezone } : row;
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
        .set({
            ...updates,
            ...(updates.serverUrl === undefined
                ? {}
                : { payload: serverTimezoneInvalidation(updates.serverUrl) }),
        })
        .where(eq(schema.playlists.id, playlistId));

    return { success: true };
}

/**
 * The persisted panel clock (`serverTimezone`, payload-only) belongs to the
 * panel it was learned from: pointing the row at another server drops it,
 * so Favorites / Recent catch-up cannot keep rendering the OLD panel's
 * clock until the next account-info check (issue #1562). The removal is
 * one SQL expression inside the same UPDATE — the worker interleaves
 * requests, so a read-modify-write of the payload could hand a concurrent
 * upsert's newer payload back to the past.
 */
function serverTimezoneInvalidation(nextServerUrl: string) {
    return sql`CASE
        WHEN ${schema.playlists.serverUrl} IS NOT ${nextServerUrl}
            AND json_valid(${schema.playlists.payload})
        THEN json_remove(${schema.playlists.payload}, '$.serverTimezone')
        ELSE ${schema.playlists.payload}
    END`;
}

export interface PlaylistConnectionIdentity {
    serverUrl: string;
    username: string;
    password: string;
}

/**
 * Records the panel clock a successful account-info check learned
 * (`serverTimezone`, payload-only) as ONE conditional UPDATE: the row must
 * still point at the panel the answer came from (`DB_UPDATE_PLAYLIST` may
 * have moved it meanwhile), a payload already carrying the value is left
 * untouched, and a malformed payload is never rewritten. No read precedes
 * the write, so it can neither hand a concurrent upsert's newer payload
 * back to the past nor undo an edit that landed in between (issue #1562).
 */
export async function setPlaylistServerTimezone(
    db: AppDatabase,
    playlistId: string,
    connection: PlaylistConnectionIdentity,
    serverTimezone: string
): Promise<{ updated: boolean }> {
    const result = await db
        .update(schema.playlists)
        .set({
            payload: sql`CASE
                WHEN ${schema.playlists.payload} IS NULL
                THEN json_object('serverTimezone', ${serverTimezone})
                ELSE json_set(${schema.playlists.payload}, '$.serverTimezone', ${serverTimezone})
            END`,
        })
        .where(
            // CASE, not AND: SQLite may reorder AND terms, and json_extract
            // raises on a malformed payload unless json_valid ran first.
            sql`${schema.playlists.id} = ${playlistId}
                AND ${schema.playlists.serverUrl} IS ${connection.serverUrl}
                AND ${schema.playlists.username} IS ${connection.username}
                AND ${schema.playlists.password} IS ${connection.password}
                AND CASE
                    WHEN ${schema.playlists.payload} IS NULL THEN 1
                    WHEN json_valid(${schema.playlists.payload})
                    THEN json_extract(${schema.playlists.payload}, '$.serverTimezone') IS NOT ${serverTimezone}
                    ELSE 0
                END`
        )
        .run();

    return { updated: result.changes > 0 };
}

interface PlaylistDeletionCollection {
    readonly categoryIds: number[];
    /** Content rows per category, the unit the delete is batched by. */
    readonly contentRowCounts: CategoryRowCount[];
    readonly favoriteCount: number;
    readonly playbackPositionCount: number;
    readonly recentlyViewedCount: number;
}

async function countPlaylistRows(
    db: AppDatabase,
    table:
        | typeof schema.favorites
        | typeof schema.playbackPositions
        | typeof schema.recentlyViewed,
    playlistId: string
): Promise<number> {
    const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(table)
        .where(eq(table.playlistId, playlistId));
    return rows[0]?.count ?? 0;
}

async function collectPlaylistDeletionRows(
    db: AppDatabase,
    playlistId: string
): Promise<PlaylistDeletionCollection> {
    const [favoriteCount, recentlyViewedCount, playbackPositionCount] =
        await Promise.all([
            countPlaylistRows(db, schema.favorites, playlistId),
            countPlaylistRows(db, schema.recentlyViewed, playlistId),
            countPlaylistRows(db, schema.playbackPositions, playlistId),
        ]);

    const categoryRows = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.playlistId, playlistId));
    const categoryIds = categoryRows.map((category) => category.id);
    const contentRowCounts =
        categoryIds.length > 0
            ? await countContentRowsByCategory(
                  db,
                  eq(schema.categories.playlistId, playlistId)
              )
            : [];

    return {
        categoryIds,
        contentRowCounts,
        favoriteCount,
        playbackPositionCount,
        recentlyViewedCount,
    };
}

function countPlaylistDeletionRows(
    collection: PlaylistDeletionCollection
): number {
    return (
        collection.favoriteCount +
        collection.recentlyViewedCount +
        collection.playbackPositionCount +
        sumCategoryRowCounts(collection.contentRowCounts) +
        collection.categoryIds.length
    );
}

/**
 * Removes the playlist's rows table by table so progress and cancellation
 * keep their stage granularity, then the playlist row itself. User-data
 * tables go in one statement each (they are playlist-indexed and small next
 * to the catalog); content goes in row-budgeted category groups; categories
 * go in one statement. A stage with nothing counted is skipped — the final
 * playlist delete cascades anything that appeared in between.
 */
async function deleteCollectedPlaylistRows(
    db: AppDatabase,
    playlistId: string,
    collection: PlaylistDeletionCollection,
    control?: OperationControl
): Promise<number> {
    const userDataStages = [
        {
            phase: 'deleting-favorites',
            expected: collection.favoriteCount,
            table: schema.favorites,
        },
        {
            phase: 'deleting-recently-viewed',
            expected: collection.recentlyViewedCount,
            table: schema.recentlyViewed,
        },
        {
            phase: 'deleting-playback-positions',
            expected: collection.playbackPositionCount,
            table: schema.playbackPositions,
        },
    ] as const;

    for (const stage of userDataStages) {
        if (stage.expected === 0) {
            continue;
        }
        await checkpointOperation(control);
        const changes = await db.transaction(
            (tx) =>
                tx
                    .delete(stage.table)
                    .where(eq(stage.table.playlistId, playlistId))
                    .run().changes
        );
        await reportOperationProgress(control, {
            phase: stage.phase,
            current: changes,
            total: stage.expected,
            increment: changes,
        });
    }

    await deleteContentByCategoryGroups(db, collection.contentRowCounts, {
        control,
        phase: 'deleting-content',
    });

    const totalCategories = collection.categoryIds.length;
    if (totalCategories > 0) {
        await checkpointOperation(control);
        const changes = await deleteCategoriesWhere(
            db,
            eq(schema.categories.playlistId, playlistId)
        );
        await reportOperationProgress(control, {
            phase: 'deleting-categories',
            current: changes,
            total: totalCategories,
            increment: changes,
        });
    }

    await checkpointOperation(control);
    await db
        .delete(schema.playlists)
        .where(eq(schema.playlists.id, playlistId));
    await reportOperationProgress(control, {
        phase: 'deleting-playlist',
        current: 1,
        total: 1,
        increment: 1,
    });

    return countPlaylistDeletionRows(collection) + 1;
}

export async function deletePlaylist(
    db: AppDatabase,
    playlistId: string,
    control?: OperationControl,
    capturePhase?: DatabaseOperationPerformancePhaseCapture
): Promise<{ success: boolean }> {
    const collection = capturePhase
        ? await capturePhase.captureAsync(
              XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_COLLECT_IDS,
              () => collectPlaylistDeletionRows(db, playlistId),
              (result) => ({
                  itemCount: countPlaylistDeletionRows(result),
              })
          )
        : await collectPlaylistDeletionRows(db, playlistId);

    if (capturePhase) {
        await capturePhase.captureAsync(
            XTREAM_DATABASE_PERFORMANCE_PHASE.SQLITE_PLAYLIST_DELETE_WRITE_TRANSACTIONS,
            () =>
                deleteCollectedPlaylistRows(
                    db,
                    playlistId,
                    collection,
                    control
                ),
            (itemCount) => ({ itemCount })
        );
    } else {
        await deleteCollectedPlaylistRows(db, playlistId, collection, control);
    }

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
