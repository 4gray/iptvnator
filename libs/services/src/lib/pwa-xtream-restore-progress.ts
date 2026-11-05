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
    keys?: string[];
    /** Desired replacement until server acknowledgement; explicit page edits update it. */
    serverList?: unknown[];
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
        return !!this.receipt(this.read(name), name === 'favorites');
    }

    writeList(name: ListName, list: unknown[]): void {
        const map = this.read(name);
        const previousReceipt = this.receipt(map, name === 'favorites');
        if (previousReceipt && !previousReceipt.serverList) return;
        if (previousReceipt?.serverList) list = previousReceipt.serverList;
        const previous = map[XTREAM_RESTORE_RECEIPTS];
        const receipt: Receipt = previousReceipt ?? { id: this.id };
        if (name === 'favorites' && !previousReceipt)
            receipt.keys = list.filter(
                (key): key is string => typeof key === 'string'
            );

        if (this.storage.flushed) receipt.serverList = list;

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

    /** Export the still-unconfirmed target, rather than a server-conflicted merged list. */
    serverListFor(name: ListName): unknown[] | undefined {
        return this.receipt(this.read(name), name === 'favorites')?.serverList;
    }

    async confirmServer(): Promise<void> {
        if (!this.storage.flushed) return;
        if (!(await this.storage.flushed(this.playlistId)))
            throw new Error(
                'The server did not take the restored lists; the restore waits.'
            );
        const updates: { name: ListName; map: StoredMap; receipt: Receipt }[] =
            [];
        for (const name of [
            'favorites',
            'recentItems',
            'playbackPositions',
        ] as const) {
            const map = this.read(name);
            const receipt = this.receipt(map, name === 'favorites');
            if (!receipt)
                throw new Error(
                    'The lists changed elsewhere during the restore; its progress is missing.'
                );
            if (!receipt.serverList) continue;
            if (
                JSON.stringify(map[this.playlistId] ?? []) !==
                JSON.stringify(receipt.serverList)
            )
                throw new Error(
                    'The lists changed elsewhere during the restore; it runs again.'
                );
            updates.push({ name, map, receipt });
        }
        // All targets are confirmed before compacting any local receipt. A failed write stays pending.
        for (const { name, map, receipt } of updates) {
            const { serverList, ...confirmed } = receipt;
            void serverList;
            this.storage.setItem(
                XTREAM_USER_DATA_KEYS[name],
                JSON.stringify({
                    ...map,
                    [XTREAM_RESTORE_RECEIPTS]: {
                        ...(map[XTREAM_RESTORE_RECEIPTS] as StoredMap),
                        [this.playlistId]: confirmed,
                    },
                })
            );
        }
    }

    /** Only explicit favorite edits can supersede parked metadata; cache writes cannot. */
    pendingSnapshots(incoming: Record<string, XtreamBackupCollectionItem>) {
        const map = this.read('favorites');
        const receipt = this.receipt(map, true);
        const favorites = map[this.playlistId];
        const untouched = new Set(receipt?.keys ?? []);
        const filtered = { ...incoming };
        for (const favorite of this.state.favorites) {
            const key = `${favorite.contentType}:${favorite.xtreamId}`;
            if (
                !Array.isArray(favorites) ||
                !favorites.includes(key) ||
                !untouched.has(key)
            )
                delete filtered[key];
        }
        return filtered;
    }

    /** Untouched imported favorites still belong to pending; explicit re-additions belong to the user. */
    exportInto(entry: XtreamPlaylistBackupEntry): XtreamPlaylistBackupEntry {
        const receipt = this.receipt(this.read('favorites'), true);
        const untouched = new Set(receipt?.keys ?? []);
        const favorites = this.hasApplied('favorites')
            ? entry.userState.favorites.map((favorite) => {
                  const key = `${favorite.contentType}:${favorite.xtreamId}`;
                  const pending = this.state.favorites.find(
                      (item) =>
                          item.contentType === favorite.contentType &&
                          item.xtreamId === favorite.xtreamId
                  );
                  return untouched.has(key) && pending ? pending : favorite;
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

    private receipt(map: StoredMap, favorites = false): Receipt | undefined {
        const receipts = map[XTREAM_RESTORE_RECEIPTS];
        const saved = record(receipts) ? receipts[this.playlistId] : undefined;
        if (!record(saved) || saved['id'] !== this.id) return undefined;
        if (
            favorites &&
            (!Array.isArray(saved['keys']) ||
                saved['keys'].some((key) => typeof key !== 'string'))
        )
            throw new Error('Stored favorites restore receipt is unreadable.');
        if (
            saved['serverList'] !== undefined &&
            !Array.isArray(saved['serverList'])
        )
            throw new Error('Stored server restore target is unreadable.');
        return {
            id: this.id,
            ...(Array.isArray(saved['serverList'])
                ? { serverList: saved['serverList'] }
                : {}),
            keys: Array.isArray(saved['keys'])
                ? saved['keys'].filter(
                      (key): key is string => typeof key === 'string'
                  )
                : [],
        };
    }

    private read(name: ListName): StoredMap {
        const raw = this.storage.getItem(XTREAM_USER_DATA_KEYS[name]);
        if (raw === null) return {};
        try {
            const value: unknown = JSON.parse(raw);
            if (record(value)) return value;
        } catch {
            /* Report invalid authoritative lists below. */
        }
        throw new Error(
            `Stored ${XTREAM_USER_DATA_KEYS[name]} are unreadable.`
        );
    }
}
