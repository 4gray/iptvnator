import { isBackupPlaybackPosition as isPlaybackPosition } from './playlist-backup-playback-position';
import type {
    PlaybackPositionData,
    XtreamBackupCollectionItem,
    XtreamBackupFavoriteItem,
    XtreamBackupRecentlyViewedItem,
    XtreamPendingRestoreState,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from './user-data-storage';
import { XTREAM_USER_DATA_KEYS } from './xtream-user-data-keys';
import { PwaXtreamRestoreProgress } from './pwa-xtream-restore-progress';
import {
    readPwaXtreamVisibility,
    restorePwaXtreamVisibility,
} from './pwa-xtream-category-visibility';
import {
    favoriteWithSnapshot,
    resolveKey,
    snapshotsByKey,
    typedKey,
} from './pwa-xtream-backup-snapshots';
import { preparePwaRestore } from './pwa-xtream-restore-ack';

type StoredMap = Record<string, unknown>;
type UserDataMap = keyof typeof XTREAM_USER_DATA_KEYS;

/**
 * Backup export and restore of the Xtream favorites, recently viewed items,
 * playback positions and title snapshots the browser build keeps in
 * USER_DATA_STORAGE. `PwaXtreamDataSource` owns these maps in a library this
 * one cannot import, so their stored shapes are read here: keys are
 * `"<type>:<xtreamId>"`, or a bare provider id written by older builds.
 */
export class PwaXtreamBackupStorage {
    constructor(private readonly storage: UserDataStorage) {}

    async ready(): Promise<void> {
        await preparePwaRestore(this.storage);
    }

    getPlaybackPositions(playlistId: string): PlaybackPositionData[] {
        const positions = this.listFor('playbackPositions', playlistId);
        if (!positions.every(isPlaybackPosition))
            throw new Error('Stored playback positions are unreadable');
        return positions.map((position) => ({ ...position }));
    }

    async replacePlaybackPositions(
        playlistId: string,
        positions: PlaybackPositionData[]
    ): Promise<void> {
        await this.ready();
        await preparePwaRestore(this.storage, playlistId);
        const android =
            'TvShell' in globalThis
                ? await import('./pwa-native-playback-resets.js')
                : undefined;
        const map = this.readMap('playbackPositions');
        map[playlistId] = positions;
        android?.stampNativePlaybackPlaylistReset(map, playlistId);
        this.writeMap('playbackPositions', map);
    }

    /**
     * The entry with the playlist's stored lists, visibility and snapshots filled in.
     * An unreadable store fails the export: restore
     * treats these lists as authoritative, so "could not read" written as
     * `[]` would turn the archive into an instruction to delete.
     */
    exportInto(
        entry: XtreamPlaylistBackupEntry,
        pending?: XtreamPendingRestoreState
    ): XtreamPlaylistBackupEntry {
        const playlistId = entry.exportedId;
        const progress = pending
            ? new PwaXtreamRestoreProgress(this.storage, playlistId, pending)
            : undefined;
        const listFor = (
            name: 'favorites' | 'recentItems' | 'playbackPositions'
        ) => progress?.serverListFor(name) ?? this.listFor(name, playlistId);
        const stored = this.readMap('collectionItems')[playlistId];
        const snapshots = isRecord(stored) ? stored : {};
        const byKey = snapshotsByKey(Object.values(snapshots));

        const favorites = new Map<string, XtreamBackupFavoriteItem>();
        for (const key of listFor('favorites')) {
            const ref = resolveKey(key, snapshots);
            if (ref)
                favorites.set(
                    ref.key,
                    favoriteWithSnapshot(ref, byKey[ref.key])
                );
        }

        // Newest view wins, artwork included, as in the data source.
        const recent = new Map<string, XtreamBackupRecentlyViewedItem>();
        for (const item of listFor('recentItems')) {
            if (!isRecord(item)) continue;
            const ref = resolveKey(item['id'], snapshots);
            const viewedAt = item['viewedAt'];
            if (!ref || typeof viewedAt !== 'string') continue;
            const previous = recent.get(ref.key)?.viewedAt;
            if (!previous || Date.parse(viewedAt) > Date.parse(previous)) {
                recent.set(ref.key, {
                    ...ref.item,
                    viewedAt,
                    ...(snapshotsByKey([item['collectionItem']])[ref.key]
                        ? {
                              collectionItem: snapshotsByKey([
                                  item['collectionItem'],
                              ])[ref.key],
                          }
                        : {}),
                    ...backdropOf(item),
                });
            }
        }

        const collectionItems = [
            ...new Set([...favorites.keys(), ...recent.keys()]),
        ]
            .filter((key) => key in byKey)
            .map((key) => byKey[key]);

        const exported: XtreamPlaylistBackupEntry = {
            ...entry,
            userState: {
                ...entry.userState,
                hiddenCategories:
                    readPwaXtreamVisibility(
                        this.storage,
                        playlistId,
                        progress && pending
                            ? {
                                  id: progress.id,
                                  hiddenCategories: pending.hiddenCategories,
                              }
                            : undefined
                    ) ?? entry.userState.hiddenCategories,
                favorites: [...favorites.values()],
                recentlyViewed: [...recent.values()],
                playbackPositions: listFor('playbackPositions')
                    .filter(isPlaybackPosition)
                    .map((position) => ({ ...position })),
                ...(collectionItems.length > 0 ? { collectionItems } : {}),
            },
        };
        return progress ? progress.exportInto(exported) : exported;
    }

    /**
     * Replaces the playlist's favorites, history and positions with the
     * restore state, keyed and remapped to `playlistId`, then merges the
     * archived title snapshots into the playlist's own.
     *
     * Lists first, so the optional cache never takes space they need. A
     * failed write throws with earlier ones applied, and the caller keeps the
     * pending snapshot for the Xtream store to replay on the next open.
     * Atomic per-list receipts skip successful writes on retry, preserving user edits.
     * Browser-only cache rows come from `entry`; durable favorite snapshots
     * also travel in `state` through deferred retries. A durable snapshot
     * write must succeed before the caller consumes that pending state.
     */
    async restore(
        playlistId: string,
        state: XtreamPendingRestoreState,
        entry?: XtreamPlaylistBackupEntry
    ): Promise<void> {
        await this.ready();
        await preparePwaRestore(this.storage, playlistId);
        // A user-supplied file: the field may be anything.
        const archived: unknown = entry?.userState.collectionItems;
        const snapshots = snapshotsByKey(
            Array.isArray(archived) ? archived : []
        );
        const required: Record<string, XtreamBackupCollectionItem> = {};
        for (const favorite of state.favorites) {
            const saved = favorite.snapshot;
            const key = typedKey(favorite.contentType, favorite.xtreamId);
            if (!saved || key === null) continue;
            const cached = favoriteWithSnapshot(
                { key, item: favorite },
                snapshots[key]
            ).snapshot;
            if (
                !(['tmdbId', 'releaseYear'] as const).every(
                    (field) =>
                        saved[field] == null || saved[field] === cached?.[field]
                )
            )
                delete snapshots[key];
            required[key] = {
                id: favorite.xtreamId,
                xtream_id: favorite.xtreamId,
                type: favorite.contentType,
                title: saved.title,
                ...(saved.catalogStatus
                    ? {
                          catalog_status: saved.catalogStatus,
                          catalog_missing_reason: saved.catalogMissingReason,
                      }
                    : {}),
                ...(saved.posterUrl !== undefined
                    ? { poster_url: saved.posterUrl }
                    : {}),
                ...(saved.backdropUrl !== undefined
                    ? { backdrop_url: saved.backdropUrl }
                    : {}),
                ...(saved.tmdbId !== undefined
                    ? { tmdb_id: saved.tmdbId }
                    : {}),
                ...(saved.releaseYear !== undefined
                    ? { release_year: saved.releaseYear }
                    : {}),
                ...(saved.originalTitle !== undefined
                    ? { original_title: saved.originalTitle }
                    : {}),
                ...(favorite.addedAt !== undefined
                    ? { added_at: favorite.addedAt }
                    : {}),
                ...(favorite.position !== undefined
                    ? { position: favorite.position }
                    : {}),
            };
        }
        for (const [key, saved] of Object.entries(required))
            snapshots[key] = { ...snapshots[key], ...saved };
        const progress = new PwaXtreamRestoreProgress(
            this.storage,
            playlistId,
            state
        );
        try {
            await this.replaceLists(
                playlistId,
                state,
                progress,
                snapshots,
                required
            );
            restorePwaXtreamVisibility(
                this.storage,
                playlistId,
                state.hiddenCategories,
                progress.id
            );
        } catch (error) {
            if (!isQuotaExceeded(error)) {
                try {
                    this.mergeSnapshots(
                        playlistId,
                        progress.pendingSnapshots(snapshots)
                    );
                } catch {
                    // The list failure is the one to report.
                }
            }
            throw error;
        }
        this.mergeSnapshots(
            playlistId,
            progress.pendingSnapshots(snapshots),
            progress.pendingSnapshots(required)
        );
        await progress.confirmServer();
    }

    private async replaceLists(
        playlistId: string,
        state: XtreamPendingRestoreState,
        progress: PwaXtreamRestoreProgress,
        snapshots: Record<string, XtreamBackupCollectionItem>,
        required: Record<string, XtreamBackupCollectionItem>
    ): Promise<void> {
        const favorites = state.favorites
            .map((item) => typedKey(item.contentType, item.xtreamId))
            .filter((key): key is string => key !== null);
        progress.writeList('favorites', [...new Set(favorites)]);

        const recent: StoredMap[] = [];
        const requiredRecent: StoredMap[] = [];
        const durableKeys = new Set(
            state.favorites
                .filter((favorite) => !!favorite.snapshot)
                .map((favorite) =>
                    typedKey(favorite.contentType, favorite.xtreamId)
                )
        );
        for (const item of state.recentlyViewed) {
            const id = typedKey(item.contentType, item.xtreamId);
            if (id !== null && typeof item.viewedAt === 'string') {
                // Legacy shared history must retain its own metadata if the imported favorite is removed.
                const collectionItem =
                    snapshotsByKey([item.collectionItem])[id] ??
                    (durableKeys.has(id) ? snapshots[id] : undefined);
                const base = {
                    id,
                    viewedAt: item.viewedAt,
                    ...backdropOf(item),
                };
                const owned =
                    snapshotsByKey([item.collectionItem])[id] ?? required[id];
                requiredRecent.push({
                    ...base,
                    ...(owned ? { collectionItem: owned } : {}),
                });
                recent.push({
                    id,
                    viewedAt: item.viewedAt,
                    ...(collectionItem ? { collectionItem } : {}),
                    ...backdropOf(item),
                });
            }
        }
        try {
            progress.writeList('recentItems', recent);
        } catch (error) {
            if (!isQuotaExceeded(error)) throw error;
            progress.writeList('recentItems', requiredRecent);
        }

        const now = new Date().toISOString();
        const android =
            'TvShell' in globalThis
                ? await import('./pwa-native-playback-resets.js')
                : undefined;
        progress.writeList(
            'playbackPositions',
            state.playbackPositions.filter(isPlaybackPosition).map((item) => ({
                ...item,
                playlistId,
                updatedAt: item.updatedAt ?? now,
            })),
            android?.stampNativePlaybackPlaylistReset
        );
    }

    /**
     * A display cache the data source itself writes on a best-effort basis:
     * a damaged one is replaced, as the data source would, and a full
     * storage skips it. Durable nested favorite snapshots are the exception:
     * they may be the only saved metadata and must stay pending on failure.
     */
    private mergeSnapshots(
        playlistId: string,
        incoming: Record<string, XtreamBackupCollectionItem>,
        required: Record<string, XtreamBackupCollectionItem> = {}
    ): void {
        if (Object.keys(incoming).length === 0) return;
        const all = this.readMap('collectionItems', { replaceDamaged: true });
        const current = isRecord(all[playlistId]) ? all[playlistId] : {};
        try {
            this.writeMap('collectionItems', {
                ...all,
                [playlistId]: { ...current, ...incoming },
            });
        } catch (error) {
            if (!isQuotaExceeded(error)) throw error;
            if (Object.keys(required).length > 0)
                // Required fields must fit, but optional archive rows/fields must not block them.
                this.writeMap('collectionItems', {
                    ...all,
                    [playlistId]: { ...current, ...required },
                });
        }
    }

    private listFor(name: UserDataMap, playlistId: string): unknown[] {
        const list = this.readMap(name)[playlistId];
        if (list === undefined) return [];
        if (!Array.isArray(list)) {
            throw new Error(
                `Stored ${XTREAM_USER_DATA_KEYS[name]} of playlist "${playlistId}" are unreadable.`
            );
        }
        return list;
    }

    /**
     * Strict, unlike the data source: a storage error or a damaged value
     * throws rather than read as "nothing stored", so a write never replaces
     * entries it could not read. A cache may `replaceDamaged` values.
     */
    private readMap(
        name: UserDataMap,
        { replaceDamaged = false } = {}
    ): StoredMap {
        const key = XTREAM_USER_DATA_KEYS[name];
        const raw = this.storage.getItem(key);
        if (raw === null) return {};
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = null;
        }
        if (isRecord(parsed)) return parsed;
        if (replaceDamaged) return {};
        throw new Error(`Stored ${key} are unreadable.`);
    }

    private writeMap(name: UserDataMap, map: StoredMap): void {
        this.storage.setItem(XTREAM_USER_DATA_KEYS[name], JSON.stringify(map));
    }
}

/** Artwork saved with a view, in either spelling the data source reads. */
function backdropOf(item: object): { backdropUrl?: string } {
    const record = item as StoredMap;
    const value = record['backdropUrl'] ?? record['backdrop_url'];
    return typeof value === 'string' && value.trim()
        ? { backdropUrl: value.trim() }
        : {};
}

function isQuotaExceeded(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'QuotaExceededError';
}

function isRecord(value: unknown): value is StoredMap {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
