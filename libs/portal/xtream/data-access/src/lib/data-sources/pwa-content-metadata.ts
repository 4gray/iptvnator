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
import { rememberColdFavoriteMetadata } from './pwa-cold-favorite';

/** Detail-only module: catalog evidence and each saved identity retain separate ownership. */
export function enrichPwaContentMetadata(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey,
    current: XtreamContentItem | undefined,
    patch: ContentMetadataPatch
): XtreamContentItem | undefined {
    const normalized = normalizeContentMetadataPatch(patch);
    if (!normalized) return current;
    if (!current) {
        rememberColdFavoriteMetadata(storage, playlistId, key, normalized);
        enrichColdRecent(storage, playlistId, key, normalized);
        return undefined;
    }
    const enriched = enrichPwaCatalogMetadata(current, normalized);
    if (enriched === current) return current;
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
        storage.saveRecentItemsToStorage(
            {
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
            },
            { userEdit: false }
        );
    }
    return enriched;
}

/** Duplicate provider IDs can have distinct category rows; fill metadata in each row. */
export function enrichPwaCatalogMetadata(
    current: XtreamContentItem,
    patch: ContentMetadataPatch
): XtreamContentItem {
    const normalized = normalizeContentMetadataPatch(patch);
    if (
        !normalized ||
        !collectionSnapshotMatchesContent(
            current,
            {
                tmdb_id: normalized.tmdbId,
                release_year: normalized.releaseYear,
            },
            true
        )
    )
        return current;
    const known = normalizeCollectionIdentity(current);
    return {
        ...current,
        tmdb_id: known.tmdb_id ?? normalized.tmdbId,
        release_year: known.release_year ?? normalized.releaseYear,
        original_title: current.original_title || normalized.originalTitle,
        backdrop_url: current.backdrop_url || normalized.backdropUrl,
    };
}

/** Cold detail evidence belongs to Recent, never to another retained favorite. */
function enrichColdRecent(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey,
    patch: ContentMetadataPatch
): void {
    const allRecent = storage.getRecentItemsFromStorage();
    const snapshots = storage.getCollectionItemsFromStorage()[playlistId] ?? {};
    const identity = { tmdb_id: patch.tmdbId, release_year: patch.releaseYear };
    const recent = allRecent[playlistId];
    if (!recent) return;
    storage.saveRecentItemsToStorage(
        {
            ...allRecent,
            [playlistId]: recent.map((entry) => {
                const saved =
                    entry.collectionItem ?? snapshots[String(entry.id)];
                if (
                    !saved ||
                    itemCollectionKey(saved) !== key ||
                    !collectionSnapshotMatchesContent(saved, identity, true)
                )
                    return entry;
                const known = normalizeCollectionIdentity(saved);
                return {
                    ...entry,
                    collectionItem: {
                        ...saved,
                        tmdb_id: known.tmdb_id ?? patch.tmdbId,
                        release_year: known.release_year ?? patch.releaseYear,
                        original_title:
                            saved.original_title || patch.originalTitle,
                        backdrop_url: saved.backdrop_url || patch.backdropUrl,
                    },
                };
            }),
        },
        { userEdit: false }
    );
}
