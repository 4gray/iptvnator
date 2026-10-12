import { inject, Injectable } from '@angular/core';
import {
    PlaybackPositionData,
    XtreamBackupCollectionItem,
    XtreamBackupContentType,
    XtreamBackupFavoriteItem,
    XtreamBackupRecentlyViewedItem,
    XtreamPendingRestoreState,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { USER_DATA_STORAGE, XTREAM_USER_DATA_KEYS } from './user-data-storage';

type StoredMap = Record<string, unknown>;
type UserDataMap = keyof typeof XTREAM_USER_DATA_KEYS;

interface ResolvedKey {
    key: string;
    item: { contentType: XtreamBackupContentType; xtreamId: number };
}

const CONTENT_TYPES: readonly unknown[] = ['live', 'movie', 'series'];

/**
 * Backup export and restore of the Xtream user state the browser build keeps
 * in USER_DATA_STORAGE: favorites, recently viewed items, playback positions
 * and the title snapshots that let both lists render without a catalog.
 *
 * `PwaXtreamDataSource` (portal data-access, which this library cannot
 * import) owns these maps, so their stored shapes are read here directly.
 * Collection keys are `"<type>:<xtreamId>"`, or a bare provider id written
 * by builds that predate typed keys.
 */
@Injectable({ providedIn: 'root' })
export class PwaXtreamBackupStateService {
    private readonly storage = inject(USER_DATA_STORAGE);

    /**
     * The entry with the playlist's stored favorites, history, positions and
     * snapshots filled in. Hidden categories and pins stay as `entry` has
     * them: the browser build tracks neither.
     *
     * A store that cannot be read fails the export. Restore treats these
     * collections as authoritative, so writing "could not read" as `[]`
     * would turn the archive into an instruction to delete.
     */
    exportInto(entry: XtreamPlaylistBackupEntry): XtreamPlaylistBackupEntry {
        const playlistId = entry.exportedId;
        const stored = this.readMap('collectionItems')[playlistId];
        const snapshots = isRecord(stored) ? stored : {};

        const favorites = new Map<string, XtreamBackupFavoriteItem>();
        for (const key of this.listFor('favorites', playlistId)) {
            const ref = resolveKey(key, snapshots);
            if (ref) favorites.set(ref.key, ref.item);
        }

        // Newest view wins, as when the data source reads the list.
        const recent = new Map<string, XtreamBackupRecentlyViewedItem>();
        for (const item of this.listFor('recentItems', playlistId)) {
            const ref = isRecord(item)
                ? resolveKey(item['id'], snapshots)
                : null;
            const viewedAt = isRecord(item) ? item['viewedAt'] : undefined;
            if (!ref || typeof viewedAt !== 'string') continue;
            const previous = recent.get(ref.key)?.viewedAt;
            if (!previous || Date.parse(viewedAt) > Date.parse(previous)) {
                recent.set(ref.key, { ...ref.item, viewedAt });
            }
        }

        const byKey = snapshotsByKey(Object.values(snapshots));
        const collectionItems = [
            ...new Set([...favorites.keys(), ...recent.keys()]),
        ]
            .filter((key) => key in byKey)
            .map((key) => byKey[key]);

        return {
            ...entry,
            userState: {
                ...entry.userState,
                favorites: [...favorites.values()],
                recentlyViewed: [...recent.values()],
                playbackPositions: this.listFor('playbackPositions', playlistId)
                    .filter(isPlaybackPosition)
                    .map((position) => ({ ...position })),
                ...(collectionItems.length > 0 ? { collectionItems } : {}),
            },
        };
    }

    /**
     * Replaces the playlist's favorites, history and positions with the
     * restore state, keyed and remapped to `playlistId`, then merges the
     * archived title snapshots into the playlist's own. Those come from the
     * archive `entry`, not from `state`: the pending restore state does not
     * carry them.
     *
     * Not one transaction: a failed write leaves the earlier ones applied and
     * throws, so the caller keeps the pending snapshot, which the Xtream store
     * replays in full when the playlist next opens.
     */
    async restore(
        playlistId: string,
        state: XtreamPendingRestoreState,
        entry: XtreamPlaylistBackupEntry
    ): Promise<void> {
        // A user-supplied file: the field may be anything.
        const archivedSnapshots: unknown = entry.userState.collectionItems;
        const favorites = state.favorites
            .map((item) => typedKey(item.contentType, item.xtreamId))
            .filter((key): key is string => key !== null);
        this.writeFor('favorites', playlistId, [...new Set(favorites)]);

        const recent: { id: string; viewedAt: string }[] = [];
        for (const item of state.recentlyViewed) {
            const id = typedKey(item.contentType, item.xtreamId);
            if (id !== null && typeof item.viewedAt === 'string') {
                recent.push({ id, viewedAt: item.viewedAt });
            }
        }
        this.writeFor('recentItems', playlistId, recent);

        const now = new Date().toISOString();
        this.writeFor(
            'playbackPositions',
            playlistId,
            state.playbackPositions.filter(isPlaybackPosition).map((item) => ({
                ...item,
                playlistId,
                updatedAt: item.updatedAt ?? now,
            }))
        );

        this.mergeSnapshots(
            playlistId,
            snapshotsByKey(
                Array.isArray(archivedSnapshots) ? archivedSnapshots : []
            )
        );
    }

    /**
     * Snapshots are a display cache that the data source itself writes on a
     * best-effort basis: an unreadable cache is replaced, as the data source
     * would, and one the storage quota cannot fit leaves the restored lists
     * intact. Their titles return once the catalog loads.
     */
    private mergeSnapshots(
        playlistId: string,
        incoming: Record<string, XtreamBackupCollectionItem>
    ): void {
        if (Object.keys(incoming).length === 0) return;
        let all: StoredMap;
        try {
            all = this.readMap('collectionItems');
        } catch {
            all = {};
        }
        const current = isRecord(all[playlistId]) ? all[playlistId] : {};
        try {
            this.writeMap('collectionItems', {
                ...all,
                [playlistId]: { ...current, ...incoming },
            });
        } catch (error) {
            if (
                !(error instanceof DOMException) ||
                error.name !== 'QuotaExceededError'
            ) {
                throw error;
            }
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

    private writeFor(name: UserDataMap, playlistId: string, list: unknown[]) {
        this.writeMap(name, { ...this.readMap(name), [playlistId]: list });
    }

    /**
     * Strict, unlike the data source's lenient reads: a storage error or a
     * damaged value throws instead of reading as "nothing stored", and a
     * write never replaces other playlists' entries it could not read.
     */
    private readMap(name: UserDataMap): StoredMap {
        const key = XTREAM_USER_DATA_KEYS[name];
        const raw = this.storage.getItem(key);
        if (raw === null) return {};
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = null;
        }
        if (!isRecord(parsed)) {
            throw new Error(`Stored ${key} are unreadable.`);
        }
        return parsed;
    }

    private writeMap(name: UserDataMap, map: StoredMap): void {
        this.storage.setItem(XTREAM_USER_DATA_KEYS[name], JSON.stringify(map));
    }
}

/**
 * A typed key carries its own identity. A bare provider id resolves only
 * through the snapshot stored under it, as the data source does without a
 * complete catalog: ids repeat across live, movie and series, so a guess
 * could restore a different title. An unresolvable id is left out.
 */
function resolveKey(key: unknown, snapshots: StoredMap): ResolvedKey | null {
    if (typeof key === 'string' && key.includes(':')) {
        const [type, id, extra] = key.split(':');
        return extra === undefined ? resolved(type, Number(id)) : null;
    }
    if (typeof key !== 'number' && typeof key !== 'string') return null;
    const snapshot = snapshots[String(key)];
    return isRecord(snapshot) && snapshot['xtream_id'] === Number(key)
        ? resolved(snapshot['type'], Number(key))
        : null;
}

function resolved(type: unknown, xtreamId: number): ResolvedKey | null {
    const key = typedKey(type, xtreamId);
    if (key === null) return null;
    const contentType = type as XtreamBackupContentType;
    return { key, item: { contentType, xtreamId } };
}

function typedKey(type: unknown, xtreamId: unknown): string | null {
    return CONTENT_TYPES.includes(type) &&
        typeof xtreamId === 'number' &&
        Number.isSafeInteger(xtreamId) &&
        xtreamId > 0
        ? `${type}:${xtreamId}`
        : null;
}

/** Snapshots by typed key, whatever key they were stored under. */
function snapshotsByKey(
    items: unknown[]
): Record<string, XtreamBackupCollectionItem> {
    const byKey: Record<string, XtreamBackupCollectionItem> = {};
    for (const item of items) {
        if (!isRecord(item)) continue;
        const key = typedKey(item['type'], item['xtream_id']);
        if (key !== null) byKey[key] = item as XtreamBackupCollectionItem;
    }
    return byKey;
}

function isPlaybackPosition(value: unknown): value is PlaybackPositionData {
    return (
        isRecord(value) &&
        Number.isFinite(value['contentXtreamId']) &&
        (value['contentType'] === 'vod' ||
            value['contentType'] === 'episode') &&
        Number.isFinite(value['positionSeconds'])
    );
}

function isRecord(value: unknown): value is StoredMap {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
