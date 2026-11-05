import {
    CollectionKey,
    collectionSnapshotMatchesContent,
    StoredRecentItem,
    deduplicateRecentItems,
    itemCollectionKey,
    normalizeFavoriteStorage,
    normalizeRecentStorage,
} from './pwa-collection-identity';
import {
    XTREAM_USER_DATA_KEYS,
    writeXtreamUserDataMap,
    type UserDataStorage,
} from '@iptvnator/services';
import { XtreamContentItem } from './xtream-data-source.interface';

/** Synchronous persistence and migration using only snapshots and cached identity evidence. */
export class PwaCollectionStorage {
    constructor(
        private readonly resolveItems: (
            playlistId: string,
            ids: readonly CollectionKey[],
            catalogOnly?: boolean,
            snapshots?: Record<string, XtreamContentItem>
        ) => Map<CollectionKey, XtreamContentItem>,
        private readonly storage: UserDataStorage
    ) {}

    getLocalFavorites(playlistId: string): XtreamContentItem[] {
        const allFavorites = this.getFavoritesFromStorage();
        const playlistFavorites = allFavorites[playlistId] || [];
        const contentById = this.resolveItems(playlistId, playlistFavorites);
        const migrated = playlistFavorites.map((id) => {
            const item = contentById.get(id);
            return item ? (itemCollectionKey(item) ?? id) : id;
        });
        if (migrated.some((id, index) => id !== playlistFavorites[index])) {
            allFavorites[playlistId] = [...new Set(migrated)];
            this.tryStorageMigration(() =>
                this.saveFavoritesToStorage(allFavorites, { userEdit: false })
            );
        }
        this.persistCollectionSnapshots(playlistId, contentById);
        return [
            ...new Map(
                Array.from(contentById.values()).map((item) => [
                    itemCollectionKey(item),
                    item,
                ])
            ).values(),
        ];
    }

    getFavoritesFromStorage(): Record<string, CollectionKey[]> {
        try {
            const data = this.storage.getItem(XTREAM_USER_DATA_KEYS.favorites);
            return normalizeFavoriteStorage(data ? JSON.parse(data) : {});
        } catch {
            return {};
        }
    }

    saveFavoritesToStorage(
        favorites: Record<string, CollectionKey[]>,
        options?: { userEdit?: boolean }
    ): void {
        writeXtreamUserDataMap(
            this.storage,
            XTREAM_USER_DATA_KEYS.favorites,
            favorites,
            options
        );
    }

    private savedFavorite(
        playlistId: string,
        key: CollectionKey
    ): XtreamContentItem | undefined {
        return [
            ...this.resolveItems(
                playlistId,
                this.getFavoritesFromStorage()[playlistId] ?? []
            ).values(),
        ].find((item) => itemCollectionKey(item) === key);
    }

    hasFavoriteIdentityConflict(
        playlistId: string,
        key: CollectionKey,
        expected?: Pick<XtreamContentItem, 'tmdb_id' | 'release_year'>
    ): boolean {
        const saved = this.savedFavorite(playlistId, key);
        return (
            !!saved &&
            !collectionSnapshotMatchesContent(
                saved,
                expected ??
                    this.resolveItems(playlistId, [key], true, {
                        [key]: saved,
                    }).get(key),
                saved.catalog_missing_reason !== 'identity_conflict' &&
                    !(
                        saved.catalog_status === 'missing' &&
                        saved.catalog_missing_reason !== 'absent'
                    )
            )
        );
    }

    clearFavoritesForPlaylist(playlistId: string): void {
        const allFavorites = this.getFavoritesFromStorage();
        delete allFavorites[playlistId];
        this.saveFavoritesToStorage(allFavorites);
    }

    getLocalRecentItems(playlistId: string): XtreamContentItem[] {
        const allRecent = this.getRecentItemsFromStorage();
        const playlistRecent = allRecent[playlistId] || [];
        const snapshots = {
            ...this.getCollectionItemsFromStorage()[playlistId],
        };
        const independentKeys = new Set<CollectionKey>();
        for (const entry of playlistRecent) {
            if (!entry.collectionItem) continue;
            const key = itemCollectionKey(entry.collectionItem);
            if (key !== null) {
                const shared = snapshots[key];
                // Matching snapshots share unavailable evidence, never presentation or another identity.
                snapshots[key] =
                    shared?.catalog_status === 'missing' &&
                    collectionSnapshotMatchesContent(
                        shared,
                        entry.collectionItem
                    ) &&
                    collectionSnapshotMatchesContent(
                        entry.collectionItem,
                        shared
                    )
                        ? {
                              ...entry.collectionItem,
                              catalog_status: 'missing',
                              catalog_missing_reason:
                                  shared.catalog_missing_reason,
                          }
                        : entry.collectionItem;
                independentKeys.add(entry.id);
            }
        }
        const contentById = this.resolveItems(
            playlistId,
            playlistRecent.map((item) => item.id),
            false,
            snapshots
        );
        const migrated = deduplicateRecentItems(
            playlistRecent.map((entry) => {
                const item = contentById.get(entry.id);
                return item
                    ? {
                          ...entry,
                          id: itemCollectionKey(item) ?? entry.id,
                          ...(entry.collectionItem
                              ? { collectionItem: item }
                              : {}),
                      }
                    : entry;
            })
        );
        if (
            migrated.length !== playlistRecent.length ||
            migrated.some(
                (entry, index) =>
                    entry.id !== playlistRecent[index].id ||
                    entry.collectionItem !==
                        playlistRecent[index].collectionItem
            )
        ) {
            allRecent[playlistId] = migrated;
            this.tryStorageMigration(() =>
                this.saveRecentItemsToStorage(allRecent, { userEdit: false })
            );
        }
        this.persistCollectionSnapshots(
            playlistId,
            new Map(
                [...contentById].filter(([key]) => !independentKeys.has(key))
            )
        );
        const results: (XtreamContentItem & { viewed_at: string })[] = [];
        const migratedContent = this.resolveItems(
            playlistId,
            migrated.map((item) => item.id),
            false,
            snapshots
        );
        for (const recentEntry of migrated) {
            const item = migratedContent.get(recentEntry.id);
            if (!item) {
                continue;
            }

            results.push({
                ...item,
                backdrop_url: recentEntry.backdropUrl ?? item.backdrop_url,
                viewed_at: recentEntry.viewedAt,
            });
        }

        // Sort by viewed_at descending
        results.sort(
            (a, b) =>
                new Date(b.viewed_at).getTime() -
                new Date(a.viewed_at).getTime()
        );

        return results as XtreamContentItem[];
    }

    getRecentItemsFromStorage(): Record<string, StoredRecentItem[]> {
        try {
            const data = this.storage.getItem(
                XTREAM_USER_DATA_KEYS.recentItems
            );
            return normalizeRecentStorage(data ? JSON.parse(data) : {});
        } catch {
            return {};
        }
    }

    saveRecentItemsToStorage(
        recentItems: Record<string, StoredRecentItem[]>,
        options?: { userEdit?: boolean }
    ): void {
        writeXtreamUserDataMap(
            this.storage,
            XTREAM_USER_DATA_KEYS.recentItems,
            recentItems,
            options
        );
    }

    clearRecentItemsForPlaylist(playlistId: string): void {
        const allRecent = this.getRecentItemsFromStorage();
        delete allRecent[playlistId];
        this.saveRecentItemsToStorage(allRecent);
    }

    getCollectionItemsFromStorage(): Record<
        string,
        Record<string, XtreamContentItem>
    > {
        try {
            const data = this.storage.getItem(
                XTREAM_USER_DATA_KEYS.collectionItems
            );
            const parsed = data ? JSON.parse(data) : {};
            if (!parsed || typeof parsed !== 'object') {
                return {};
            }
            return parsed as Record<string, Record<string, XtreamContentItem>>;
        } catch {
            return {};
        }
    }

    saveCollectionItemsToStorage(
        items: Record<string, Record<string, XtreamContentItem>>
    ): void {
        this.storage.setItem(
            XTREAM_USER_DATA_KEYS.collectionItems,
            JSON.stringify(items)
        );
    }

    /** Optional migration/cache writes must not block readable legacy collections. */
    private tryStorageMigration(write: () => void): void {
        try {
            write();
        } catch (error) {
            if (
                !(error instanceof DOMException) ||
                error.name !== 'QuotaExceededError'
            ) {
                throw error;
            }
        }
    }

    private trySaveCollectionItemsToStorage(
        items: Record<string, Record<string, XtreamContentItem>>
    ): void {
        this.tryStorageMigration(() =>
            this.saveCollectionItemsToStorage(items)
        );
    }

    clearCollectionItemsForPlaylist(playlistId: string): void {
        const allItems = this.getCollectionItemsFromStorage();
        delete allItems[playlistId];
        this.saveCollectionItemsToStorage(allItems);
    }

    private persistCollectionSnapshots(
        playlistId: string,
        items: Map<CollectionKey, XtreamContentItem>
    ): void {
        if (!items.size) return;
        const allItems = this.getCollectionItemsFromStorage();
        const snapshots = allItems[playlistId] ?? {};
        for (const item of items.values()) {
            const key = itemCollectionKey(item);
            if (key === null) continue;
            snapshots[key] = {
                ...item,
                backdrop_url: item.backdrop_url ?? snapshots[key]?.backdrop_url,
            };
        }
        this.trySaveCollectionItemsToStorage({
            ...allItems,
            [playlistId]: snapshots,
        });
    }

    saveCollectionItemSnapshot(
        playlistId: string,
        contentId: CollectionKey,
        backdropUrl?: string
    ): void {
        const item = this.resolveItems(playlistId, [contentId]).get(contentId);
        if (!item) {
            return;
        }

        const normalizedBackdropUrl = backdropUrl?.trim();
        const allItems = this.getCollectionItemsFromStorage();
        const playlistItems = allItems[playlistId] ?? {};
        playlistItems[String(contentId)] = {
            ...item,
            ...(normalizedBackdropUrl &&
            !item.backdrop_url &&
            this.canEnrichSnapshot(playlistId, contentId, item)
                ? { backdrop_url: normalizedBackdropUrl }
                : {}),
        };
        this.trySaveCollectionItemsToStorage({
            ...allItems,
            [playlistId]: playlistItems,
        });
    }

    private canEnrichSnapshot(
        playlistId: string,
        key: CollectionKey,
        saved: XtreamContentItem
    ): boolean {
        // A merged collection row carries saved identity, so it is not confirmation.
        return collectionSnapshotMatchesContent(
            saved,
            this.resolveItems(playlistId, [key], true).get(key)
        );
    }
}
