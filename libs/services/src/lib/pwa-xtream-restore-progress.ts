import { normalizeContentMetadataPatch } from '@iptvnator/shared/interfaces';
import type {
    XtreamBackupCollectionItem,
    XtreamPendingRestoreState,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { normalizeXtreamPendingRestoreState } from '@iptvnator/shared/interfaces/xtream-restore-state';
import type { UserDataStorage } from './user-data-storage';
import {
    XTREAM_RESTORE_RECEIPTS,
    XTREAM_USER_DATA_KEYS,
} from './xtream-user-data-keys';

type ListName = 'favorites' | 'recentItems' | 'playbackPositions';
type StoredMap = Record<string, unknown>;
interface Receipt {
    id: string;
    snapshots?: Record<string, string>;
}
const record = (value: unknown): value is StoredMap =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/** Each list and its receipt commit in one blob; subsequent user edits keep the receipt. */
export class PwaXtreamRestoreProgress {
    private readonly id: string;
    constructor(
        private readonly storage: UserDataStorage,
        private readonly playlistId: string,
        private readonly state: XtreamPendingRestoreState
    ) {
        // Old parked states have no explicit ID. Canonical normalized state is an exact receipt.
        this.id =
            state.favoritesRestoreId ??
            JSON.stringify(normalizeXtreamPendingRestoreState(state));
    }

    hasApplied(name: ListName): boolean {
        return !!this.receipt(this.read(name));
    }

    writeList(name: ListName, list: unknown[]): void {
        const map = this.read(name);
        if (this.receipt(map)) return;
        const previous = map[XTREAM_RESTORE_RECEIPTS];
        const receipt: Receipt = { id: this.id };
        if (name === 'favorites') {
            const stored = this.read('collectionItems')[this.playlistId];
            receipt.snapshots = {};
            for (const favorite of this.state.favorites) {
                const key = `${favorite.contentType}:${favorite.xtreamId}`;
                receipt.snapshots[key] = snapshotVersion(
                    record(stored) ? stored[key] : undefined
                );
            }
        }
        this.storage.setItem(
            XTREAM_USER_DATA_KEYS[name],
            JSON.stringify({
                ...map,
                [this.playlistId]: list,
                [XTREAM_RESTORE_RECEIPTS]: {
                    ...(record(previous) ? previous : {}),
                    [this.playlistId]: receipt,
                },
            })
        );
    }

    /** Retry missing metadata, but never replace a snapshot explicitly changed since list commit. */
    pendingSnapshots(incoming: Record<string, XtreamBackupCollectionItem>) {
        const map = this.read('favorites');
        const receipt = this.receipt(map);
        const favorites = map[this.playlistId];
        const stored = this.read('collectionItems')[this.playlistId];
        const filtered = { ...incoming };
        for (const [key, version] of Object.entries(receipt?.snapshots ?? {})) {
            if (
                !Array.isArray(favorites) ||
                !favorites.includes(key) ||
                snapshotVersion(record(stored) ? stored[key] : undefined) !==
                    version
            )
                delete filtered[key];
        }
        return filtered;
    }

    /** Applied lists belong to the user; unwritten snapshots still have an owner in pending. */
    exportInto(entry: XtreamPlaylistBackupEntry): XtreamPlaylistBackupEntry {
        const receipt = this.receipt(this.read('favorites'));
        const stored = this.read('collectionItems')[this.playlistId];
        const favorites = this.hasApplied('favorites')
            ? entry.userState.favorites.map((favorite) => {
                  const pending = this.state.favorites.find(
                      (item) =>
                          item.contentType === favorite.contentType &&
                          item.xtreamId === favorite.xtreamId
                  );
                  const key = `${favorite.contentType}:${favorite.xtreamId}`;
                  const unchanged =
                      receipt?.snapshots?.[key] ===
                      snapshotVersion(record(stored) ? stored[key] : undefined);
                  if (!unchanged) return favorite;
                  const snapshot = pending?.snapshot ?? favorite.snapshot;
                  return {
                      ...pending,
                      ...favorite,
                      ...(snapshot ? { snapshot } : {}),
                  };
              })
            : this.state.favorites;
        const recentlyViewed = this.hasApplied('recentItems')
            ? entry.userState.recentlyViewed
            : this.state.recentlyViewed;
        const keys = new Set(
            [...favorites, ...recentlyViewed].map(
                (item) => `${item.contentType}:${item.xtreamId}`
            )
        );
        const { collectionItems, ...userState } = entry.userState;
        const relevant = collectionItems?.filter((item) =>
            keys.has(`${item['type']}:${item['xtream_id']}`)
        );
        return {
            ...entry,
            userState: {
                ...userState,
                favorites,
                recentlyViewed,
                playbackPositions: this.hasApplied('playbackPositions')
                    ? entry.userState.playbackPositions
                    : this.state.playbackPositions,
                ...(relevant?.length ? { collectionItems: relevant } : {}),
            },
        };
    }

    private receipt(map: StoredMap): Receipt | undefined {
        const receipts = map[XTREAM_RESTORE_RECEIPTS];
        const saved = record(receipts) ? receipts[this.playlistId] : undefined;
        if (!record(saved) || saved['id'] !== this.id) return undefined;
        return {
            id: this.id,
            ...(record(saved['snapshots'])
                ? { snapshots: saved['snapshots'] as Record<string, string> }
                : {}),
        };
    }

    private read(name: keyof typeof XTREAM_USER_DATA_KEYS): StoredMap {
        const raw = this.storage.getItem(XTREAM_USER_DATA_KEYS[name]);
        if (raw === null) return {};
        try {
            const value: unknown = JSON.parse(raw);
            if (record(value)) return value;
        } catch {
            /* Report invalid authoritative lists below. */
        }
        if (name === 'collectionItems') return {};
        throw new Error(
            `Stored ${XTREAM_USER_DATA_KEYS[name]} are unreadable.`
        );
    }
}

/** Availability/category cache changes do not constitute replacement of a user's saved identity. */
function snapshotVersion(value: unknown): string {
    if (!record(value)) return 'null';
    const identity = normalizeContentMetadataPatch({
        tmdbId: value['tmdb_id'] as number,
        releaseYear: value['release_year'] as number,
    });
    return JSON.stringify(
        [
            'title',
            'poster_url',
            'backdrop_url',
            'tmdb_id',
            'release_year',
            'original_title',
            'added_at',
            'position',
        ].map((key) =>
            key === 'tmdb_id'
                ? (identity?.tmdbId ?? null)
                : key === 'release_year'
                  ? (identity?.releaseYear ?? null)
                  : (value[key] ?? null)
        )
    );
}
