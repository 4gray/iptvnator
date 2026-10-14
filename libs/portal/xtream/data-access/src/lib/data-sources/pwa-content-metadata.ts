import {
    normalizeContentMetadataPatch,
    type ContentMetadataPatch,
} from '@iptvnator/shared/interfaces';
import {
    collectionSnapshotMatchesContent,
    itemCollectionKey,
    mergeCollectionItem,
    normalizeCollectionIdentity,
    type CollectionKey,
} from './pwa-collection-identity';
import type { PwaCollectionStorage } from './pwa-collection-storage';
import type { XtreamContentItem } from './xtream-data-source.interface';

/** Detail-only module: catalog evidence and each saved identity retain separate ownership. */
export function enrichPwaContentMetadata(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey,
    current: XtreamContentItem,
    patch: ContentMetadataPatch
): XtreamContentItem {
    const normalized = normalizeContentMetadataPatch(patch);
    if (!normalized) return current;
    const identity = {
        tmdb_id: normalized.tmdbId,
        release_year: normalized.releaseYear,
    };
    // A stale/conflicting detail response must not enrich a different known movie.
    if (!collectionSnapshotMatchesContent(current, identity, true))
        return current;
    const known = normalizeCollectionIdentity(current);
    const enriched = {
        ...current,
        tmdb_id: known.tmdb_id ?? normalized.tmdbId,
        release_year: known.release_year ?? normalized.releaseYear,
        original_title: current.original_title || normalized.originalTitle,
        backdrop_url: current.backdrop_url || normalized.backdropUrl,
    };
    const allSnapshots = storage.getCollectionItemsFromStorage();
    const snapshots = allSnapshots[playlistId] ?? {};
    const updated = { ...snapshots };
    for (const [storedKey, saved] of Object.entries(snapshots)) {
        if (itemCollectionKey(saved) === key)
            updated[storedKey] = mergeCollectionItem(saved, enriched);
    }
    // These are enrichment/cache writes; quota must not destroy readable collections.
    try {
        storage.saveCollectionItemsToStorage({
            ...allSnapshots,
            [playlistId]: updated,
        });
    } catch {
        /* optional cache */
    }

    const allRecent = storage.getRecentItemsFromStorage();
    const recent = allRecent[playlistId];
    if (recent) {
        storage.saveRecentItemsToStorage({
            ...allRecent,
            [playlistId]: recent.map((entry) => {
                const saved =
                    entry.collectionItem ?? snapshots[String(entry.id)];
                if (
                    entry.id !== key &&
                    (!saved || itemCollectionKey(saved) !== key)
                )
                    return entry;
                const resolved = saved
                    ? mergeCollectionItem(saved, enriched)
                    : enriched;
                return {
                    ...entry,
                    ...(entry.collectionItem
                        ? { collectionItem: resolved }
                        : {}),
                    ...(resolved.backdrop_url && !entry.backdropUrl
                        ? { backdropUrl: resolved.backdrop_url }
                        : {}),
                };
            }),
        });
    }
    return enriched;
}
