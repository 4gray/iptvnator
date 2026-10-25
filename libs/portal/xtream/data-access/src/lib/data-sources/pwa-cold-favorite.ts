import type { ContentMetadataPatch } from '@iptvnator/shared/interfaces';
import {
    collectionSnapshotMatchesContent,
    itemCollectionKey,
    normalizeCollectionIdentity,
    type CollectionKey,
} from './pwa-collection-identity';
import type { PwaCollectionStorage } from './pwa-collection-storage';
import type { XtreamContentItem } from './xtream-data-source.interface';

// One displayed detail per data source; never catalog evidence or a durable write.
const details = new WeakMap<
    PwaCollectionStorage,
    {
        playlistId: string;
        key: CollectionKey;
        storedKey: string;
        source: string;
        item: XtreamContentItem;
    }
>();

export function coldFavoriteCandidate(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey
): XtreamContentItem | undefined {
    const detail = details.get(storage);
    if (
        detail?.playlistId === playlistId &&
        detail.key === key &&
        JSON.stringify(
            storage.getCollectionItemsFromStorage()[playlistId]?.[
                detail.storedKey
            ]
        ) === detail.source
    )
        return detail.item;
    return undefined;
}

/** Retain detail enrichment until an explicit save, without rewriting an older favorite. */
export function rememberColdFavoriteMetadata(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey,
    patch: ContentMetadataPatch
): void {
    const snapshots = storage.getCollectionItemsFromStorage()[playlistId] ?? {};
    const storedKey = snapshots[String(key)]
        ? String(key)
        : Object.keys(snapshots).find(
              (candidate) => itemCollectionKey(snapshots[candidate]) === key
          );
    const saved = storedKey === undefined ? undefined : snapshots[storedKey];
    const previous = coldFavoriteCandidate(storage, playlistId, key);
    details.delete(storage);
    const identity = { tmdb_id: patch.tmdbId, release_year: patch.releaseYear };
    if (
        !saved ||
        storedKey === undefined ||
        !collectionSnapshotMatchesContent(saved, identity, true)
    )
        return;
    const base =
        previous && collectionSnapshotMatchesContent(previous, identity, true)
            ? previous
            : saved;
    const known = normalizeCollectionIdentity(base);
    details.set(storage, {
        playlistId,
        key,
        storedKey,
        source: JSON.stringify(saved),
        item: {
            ...base,
            tmdb_id: known.tmdb_id ?? patch.tmdbId,
            release_year: known.release_year ?? patch.releaseYear,
            original_title: base.original_title || patch.originalTitle,
            backdrop_url: base.backdrop_url || patch.backdropUrl,
        },
    });
}
