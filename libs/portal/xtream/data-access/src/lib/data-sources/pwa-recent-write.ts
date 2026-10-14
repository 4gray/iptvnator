import {
    collectionSnapshotMatchesContent,
    deduplicateRecentItems,
    itemCollectionKey,
    type CollectionKey,
} from './pwa-collection-identity';
import type { PwaCollectionStorage } from './pwa-collection-storage';
import type { XtreamContentItem } from './xtream-data-source.interface';

/** Keep the snapshot and viewedAt write synchronous against fresh storage. */
export function addPwaRecentItem(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey,
    resolveItems: (
        ids: readonly CollectionKey[],
        catalogOnly?: boolean
    ) => Map<CollectionKey, XtreamContentItem>,
    matchingKeysFor: (ids: CollectionKey[]) => Set<CollectionKey>,
    backdropUrl?: string
): void {
    const normalizedBackdropUrl = backdropUrl?.trim();

    const allRecent = storage.getRecentItemsFromStorage();
    if (!allRecent[playlistId]) {
        allRecent[playlistId] = [];
    }

    // Compare logical identities without expanding legacy keys before the save.
    const storedItems = resolveItems(
        allRecent[playlistId].map((item) => item.id)
    );
    allRecent[playlistId] = deduplicateRecentItems(
        allRecent[playlistId],
        (entry) => {
            const item = storedItems.get(entry.id);
            return item ? (itemCollectionKey(item) ?? entry.id) : entry.id;
        }
    );

    // Remove existing entry if present
    const matchingKeys = matchingKeysFor(
        allRecent[playlistId].map((item) => item.id)
    );
    const previous = allRecent[playlistId].find((r) => matchingKeys.has(r.id));
    allRecent[playlistId] = allRecent[playlistId].filter(
        (r) => !matchingKeys.has(r.id)
    );

    // Add new entry at the beginning
    const current = resolveItems([key], true).get(key);
    const saved = resolveItems([key]).get(key);
    const collectionItem =
        current &&
        (previous?.collectionItem ||
            (saved && !collectionSnapshotMatchesContent(saved, current)))
            ? current
            : previous?.collectionItem;
    allRecent[playlistId].unshift({
        ...(collectionItem ? { collectionItem } : {}),
        id: key,
        viewedAt: new Date().toISOString(),
        ...(normalizedBackdropUrl
            ? { backdropUrl: normalizedBackdropUrl }
            : {}),
    });

    // Keep only last 50 items
    allRecent[playlistId] = allRecent[playlistId].slice(0, 50);

    storage.saveRecentItemsToStorage(allRecent);
    storage.getLocalRecentItems(playlistId);
    storage.saveCollectionItemSnapshot(playlistId, key, normalizedBackdropUrl);
}
