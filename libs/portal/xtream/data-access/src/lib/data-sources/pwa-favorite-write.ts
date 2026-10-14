import { XTREAM_FAVORITE_IDENTITY_CONFLICT } from '@iptvnator/shared/interfaces';
import {
    collectionSnapshotMatchesContent,
    itemCollectionKey,
    type CollectionKey,
} from './pwa-collection-identity';
import type { PwaCollectionStorage } from './pwa-collection-storage';
import type { XtreamContentItem } from './xtream-data-source.interface';

/** Loaded only for an explicit favorite action; all storage writes remain synchronous. */
export function addPwaFavorite(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey,
    current: XtreamContentItem | undefined,
    matchingKeysFor: (ids: CollectionKey[]) => Set<CollectionKey>,
    backdropUrl?: string
): void {
    if (storage.hasFavoriteIdentityConflict(playlistId, key)) {
        throw new Error(XTREAM_FAVORITE_IDENTITY_CONFLICT);
    }
    const allFavorites = storage.getFavoritesFromStorage();
    const ids = (allFavorites[playlistId] ??= []);
    const matchingKeys = matchingKeysFor(ids);
    if (!ids.some((id) => matchingKeys.has(id))) {
        prepareReplacement(storage, playlistId, key, current, backdropUrl);
        ids.push(key);
    }
    storage.saveFavoritesToStorage(allFavorites);
    storage.getLocalFavorites(playlistId);
    storage.saveCollectionItemSnapshot(playlistId, key, backdropUrl);
}

/** Only a new explicit favorite can replace the identity of a removed favorite. */
function prepareReplacement(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey,
    current: XtreamContentItem | undefined,
    backdropUrl?: string
): void {
    if (!current) return;
    const allItems = storage.getCollectionItemsFromStorage();
    const snapshots = allItems[playlistId] ?? {};
    const keys = Object.keys(snapshots).filter(
        (storedKey) => itemCollectionKey(snapshots[storedKey]) === key
    );
    if (
        keys.every((storedKey) =>
            collectionSnapshotMatchesContent(snapshots[storedKey], current)
        )
    )
        return;
    for (const storedKey of keys) {
        snapshots[storedKey] = {
            ...current,
            backdrop_url: current.backdrop_url || backdropUrl?.trim(),
        };
    }
    // Required before adding the reference: quota must not revive the old identity.
    storage.saveCollectionItemsToStorage({
        ...allItems,
        [playlistId]: snapshots,
    });
}
