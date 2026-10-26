import {
    collectionSnapshotMatchesContent,
    typedCollectionRef,
    deduplicateRecentItems,
    itemCollectionKey,
    type CollectionKey,
} from './pwa-collection-identity';
import type { PwaCollectionStorage } from './pwa-collection-storage';
import { normalizeContentMetadataPatch } from '@iptvnator/shared/interfaces';
import type {
    XtreamContentItem,
    XtreamPlayedContent,
} from './xtream-data-source.interface';

/** Read the latest history only after the action module is available. */
export function removePwaRecentItem(
    storage: PwaCollectionStorage,
    playlistId: string,
    matchingKeysFor: (ids: CollectionKey[]) => Set<CollectionKey>
): void {
    const allRecent = storage.getRecentItemsFromStorage();
    if (allRecent[playlistId]) {
        const matchingKeys = matchingKeysFor(
            allRecent[playlistId].map((item) => item.id)
        );
        allRecent[playlistId] = allRecent[playlistId].filter(
            (item) => !matchingKeys.has(item.id)
        );
    }
    storage.saveRecentItemsToStorage(allRecent);
}

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
    backdropUrl?: string,
    playedContent?: XtreamPlayedContent
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
        playedSnapshot(key, playedContent, [
            current,
            saved,
            previous?.collectionItem,
        ]) ??
        (current &&
        (previous?.collectionItem ||
            (saved && !collectionSnapshotMatchesContent(saved, current)))
            ? current
            : previous?.collectionItem);
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

/** Playback evidence owns the new Recent row; it never becomes Favorite evidence. */
function playedSnapshot(
    key: CollectionKey,
    played: XtreamPlayedContent | undefined,
    candidates: (XtreamContentItem | undefined)[]
): XtreamContentItem | undefined {
    const ref = typedCollectionRef(key);
    if (!ref || !played?.title.trim()) return undefined;
    const patch = normalizeContentMetadataPatch(played);
    const identity = {
        tmdb_id: patch?.tmdbId,
        release_year: patch?.releaseYear,
    };
    const compatible = candidates.find(
        (item) =>
            item &&
            itemCollectionKey(item) === key &&
            collectionSnapshotMatchesContent(item, identity) &&
            (patch?.tmdbId || patch?.releaseYear || item.title === played.title)
    );
    return {
        id: ref.id,
        xtream_id: ref.id,
        type: ref.type,
        category_id: played.categoryId ?? compatible?.category_id ?? '',
        title: played.title,
        poster_url: played.posterUrl || compatible?.poster_url || '',
        rating: compatible?.rating ?? '',
        added: compatible?.added ?? '',
        ...identity,
        backdrop_url: patch?.backdropUrl || compatible?.backdrop_url,
        original_title: patch?.originalTitle || compatible?.original_title,
    };
}
