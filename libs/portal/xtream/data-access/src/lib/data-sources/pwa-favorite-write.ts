import {
    XTREAM_FAVORITE_IDENTITY_CONFLICT,
    type ContentMetadataPatch,
} from '@iptvnator/shared/interfaces';
import {
    collectionSnapshotMatchesContent,
    itemCollectionKey,
    type CollectionKey,
    type CollectionIdentity,
    type collectionRefIdentity,
} from './pwa-collection-identity';
import type { PwaCollectionStorage } from './pwa-collection-storage';
import type { XtreamContentItem } from './xtream-data-source.interface';
import { coldFavoriteCandidate } from './pwa-cold-favorite';

/** Keep removal and its identity guard in one synchronous storage operation. */
export function removePwaFavorite(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey,
    expected: ReturnType<typeof collectionRefIdentity>,
    matchingKeysFor: (ids: CollectionKey[]) => Set<CollectionKey>
): void {
    if (storage.hasFavoriteIdentityConflict(playlistId, key, expected))
        throw new Error(XTREAM_FAVORITE_IDENTITY_CONFLICT);

    const allFavorites = storage.getFavoritesFromStorage();
    if (allFavorites[playlistId]) {
        const matchingKeys = matchingKeysFor(allFavorites[playlistId]);
        allFavorites[playlistId] = allFavorites[playlistId].filter(
            (id) => !matchingKeys.has(id)
        );
    }
    storage.saveFavoritesToStorage(allFavorites);
}

/** Cold-detail preparation belongs to the explicit action, not app startup. */
export async function savePwaFavorite(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey,
    expected: ReturnType<typeof collectionRefIdentity>,
    current: (
        catalogOnly?: boolean,
        identity?: CollectionIdentity
    ) => XtreamContentItem | undefined,
    hydrate: () => Promise<unknown>,
    enrichCatalog: (patch: ContentMetadataPatch) => Promise<void>,
    matchingKeysFor: (ids: CollectionKey[]) => Set<CollectionKey>,
    backdropUrl?: string
): Promise<void> {
    if (
        expected &&
        !Object.values(
            storage.getCollectionItemsFromStorage()[playlistId] ?? {}
        ).some((item) => itemCollectionKey(item) === key)
    ) {
        if (!current()) await hydrate();
        if (current(true))
            await enrichCatalog({
                tmdbId: expected.tmdb_id,
                releaseYear: expected.release_year,
            });
    }
    addPwaFavorite(
        storage,
        playlistId,
        key,
        current(true, expected),
        matchingKeysFor,
        backdropUrl,
        expected
    );
}

/** Loaded only for an explicit favorite action; all storage writes remain synchronous. */
function addPwaFavorite(
    storage: PwaCollectionStorage,
    playlistId: string,
    key: CollectionKey,
    current: XtreamContentItem | undefined,
    matchingKeysFor: (ids: CollectionKey[]) => Set<CollectionKey>,
    backdropUrl?: string,
    expected?: Pick<XtreamContentItem, 'tmdb_id' | 'release_year'>
): void {
    if (
        storage.hasFavoriteIdentityConflict(playlistId, key) ||
        storage.hasFavoriteIdentityConflict(playlistId, key, expected)
    ) {
        throw new Error(XTREAM_FAVORITE_IDENTITY_CONFLICT);
    }
    const allFavorites = storage.getFavoritesFromStorage();
    const ids = (allFavorites[playlistId] ??= []);
    const matchingKeys = matchingKeysFor(ids);
    if (!ids.some((id) => matchingKeys.has(id))) {
        const candidate = expected
            ? [
                  current,
                  ...(storage
                      .getRecentItemsFromStorage()
                      [playlistId]?.map((entry) => entry.collectionItem) ?? []),
                  coldFavoriteCandidate(storage, playlistId, key),
                  ...Object.values(
                      storage.getCollectionItemsFromStorage()[playlistId] ?? {}
                  ),
              ].find(
                  (item) =>
                      item &&
                      itemCollectionKey(item) === key &&
                      collectionSnapshotMatchesContent(expected, item)
              )
            : current;
        if (expected && !candidate)
            throw new Error('XTREAM_FAVORITE_SAVE_FAILED');
        prepareReplacement(
            storage,
            playlistId,
            key,
            candidate,
            backdropUrl,
            candidate === current
        );
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
    backdropUrl?: string,
    catalogEvidence = true
): void {
    if (!current) return;
    const allItems = storage.getCollectionItemsFromStorage();
    const snapshots = allItems[playlistId] ?? {};
    const keys = Object.keys(snapshots).filter(
        (storedKey) => itemCollectionKey(snapshots[storedKey]) === key
    );
    if (
        (keys.length > 0 || catalogEvidence) &&
        keys.every(
            (storedKey) =>
                collectionSnapshotMatchesContent(
                    snapshots[storedKey],
                    current
                ) &&
                (catalogEvidence ||
                    collectionSnapshotMatchesContent(
                        current,
                        snapshots[storedKey]
                    ))
        )
    )
        return;
    // Recent may still share the old snapshot. Detach it before replacing that
    // snapshot, or saving an unwatched replacement would rewrite viewing history.
    const allRecent = storage.getRecentItemsFromStorage();
    let detached = false;
    const recent = (allRecent[playlistId] ?? []).map((entry) => {
        const saved =
            snapshots[String(entry.id)] ??
            (entry.id === key ? snapshots[keys[0]] : undefined);
        if (entry.collectionItem || !saved || itemCollectionKey(saved) !== key)
            return entry;
        detached = true;
        return { ...entry, collectionItem: saved };
    });
    if (detached)
        storage.saveRecentItemsToStorage(
            {
                ...allRecent,
                [playlistId]: recent,
            },
            { userEdit: false }
        );

    for (const storedKey of new Set([...keys, String(key)])) {
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
