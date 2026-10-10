import {
    CollectionKey,
    StoredRecentItem,
    deduplicateRecentItems,
    itemCollectionKey,
    normalizeFavoriteStorage,
    normalizeRecentStorage,
} from './pwa-collection-identity';
import { XtreamContentItem } from './xtream-data-source.interface';

const STORAGE_KEYS = {
    COLLECTION_ITEMS: 'xtream-collection-items',
    FAVORITES: 'xtream-favorites',
    RECENT_ITEMS: 'xtream-recent-items',
};

/** Synchronous persistence and migration using only snapshots and cached identity evidence. */
export class PwaCollectionStorage {
    constructor(
        private readonly resolveItems: (
            playlistId: string,
            ids: readonly CollectionKey[]
        ) => Map<CollectionKey, XtreamContentItem>
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
                this.saveFavoritesToStorage(allFavorites)
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
            const data = localStorage.getItem(STORAGE_KEYS.FAVORITES);
            return normalizeFavoriteStorage(data ? JSON.parse(data) : {});
        } catch {
            return {};
        }
    }

    saveFavoritesToStorage(favorites: Record<string, CollectionKey[]>): void {
        localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
    }

    clearFavoritesForPlaylist(playlistId: string): void {
        const allFavorites = this.getFavoritesFromStorage();
        delete allFavorites[playlistId];
        this.saveFavoritesToStorage(allFavorites);
    }

    getLocalRecentItems(playlistId: string): XtreamContentItem[] {
        const allRecent = this.getRecentItemsFromStorage();
        const playlistRecent = allRecent[playlistId] || [];
        const contentById = this.resolveItems(
            playlistId,
            playlistRecent.map((item) => item.id)
        );
        const migrated = deduplicateRecentItems(
            playlistRecent.map((entry) => {
                const item = contentById.get(entry.id);
                return item
                    ? { ...entry, id: itemCollectionKey(item) ?? entry.id }
                    : entry;
            })
        );
        if (
            migrated.length !== playlistRecent.length ||
            migrated.some(
                (entry, index) => entry.id !== playlistRecent[index].id
            )
        ) {
            allRecent[playlistId] = migrated;
            this.tryStorageMigration(() =>
                this.saveRecentItemsToStorage(allRecent)
            );
        }
        this.persistCollectionSnapshots(playlistId, contentById);
        const results: (XtreamContentItem & { viewed_at: string })[] = [];
        const migratedContent = this.resolveItems(
            playlistId,
            migrated.map((item) => item.id)
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
            const data = localStorage.getItem(STORAGE_KEYS.RECENT_ITEMS);
            return normalizeRecentStorage(data ? JSON.parse(data) : {});
        } catch {
            return {};
        }
    }

    saveRecentItemsToStorage(
        recentItems: Record<string, StoredRecentItem[]>
    ): void {
        localStorage.setItem(
            STORAGE_KEYS.RECENT_ITEMS,
            JSON.stringify(recentItems)
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
            const data = localStorage.getItem(STORAGE_KEYS.COLLECTION_ITEMS);
            const parsed = data ? JSON.parse(data) : {};
            if (!parsed || typeof parsed !== 'object') {
                return {};
            }
            return parsed as Record<string, Record<string, XtreamContentItem>>;
        } catch {
            return {};
        }
    }

    private saveCollectionItemsToStorage(
        items: Record<string, Record<string, XtreamContentItem>>
    ): void {
        localStorage.setItem(
            STORAGE_KEYS.COLLECTION_ITEMS,
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
            ...(normalizedBackdropUrl && !item.backdrop_url
                ? { backdrop_url: normalizedBackdropUrl }
                : {}),
        };
        this.trySaveCollectionItemsToStorage({
            ...allItems,
            [playlistId]: playlistItems,
        });
    }

    setCollectionItemBackdropIfMissing(
        playlistId: string,
        contentId: CollectionKey,
        backdropUrl: string
    ): void {
        const allItems = this.getCollectionItemsFromStorage();
        const playlistItems = allItems[playlistId];
        const item = playlistItems?.[String(contentId)];
        if (!item || item.backdrop_url) {
            return;
        }

        this.trySaveCollectionItemsToStorage({
            ...allItems,
            [playlistId]: {
                ...playlistItems,
                [String(contentId)]: {
                    ...item,
                    backdrop_url: backdropUrl,
                },
            },
        });
    }
}
