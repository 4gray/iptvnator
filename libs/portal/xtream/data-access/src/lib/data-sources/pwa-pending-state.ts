import type {
    PlaybackPositionData,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';
import {
    type CollectionKey,
    normalizeStoredBackdrop,
    typedCollectionRef,
} from './pwa-collection-identity';
import type { PwaCollectionStorage } from './pwa-collection-storage';
import type { XtreamContentItem } from './xtream-data-source.interface';

/** Serialize retained collection data before clearing the provider's session cache. */
export function snapshotPwaPendingState(
    storage: PwaCollectionStorage,
    playlistId: string,
    playbackPositions: PlaybackPositionData[],
    resolveItems: (
        ids: readonly CollectionKey[]
    ) => Map<CollectionKey, XtreamContentItem>
): XtreamPendingRestoreState {
    const findContentIdentity = (key: CollectionKey) => {
        const ref = typedCollectionRef(key);
        if (ref) return { contentType: ref.type, xtreamId: ref.id };
        const item = resolveItems([key]).get(key);
        const identity = item
            ? typedCollectionRef({ id: item.xtream_id, type: item.type })
            : null;
        return identity
            ? { contentType: identity.type, xtreamId: identity.id }
            : null;
    };

    const favorites = storage.getFavoritesFromStorage();
    const recentItems = storage.getRecentItemsFromStorage();

    const typedFavorites = (favorites[playlistId] || [])
        .map((xtreamId) => findContentIdentity(xtreamId))
        .filter(
            (
                value
            ): value is {
                contentType: 'live' | 'movie' | 'series';
                xtreamId: number;
            } => value !== null
        );

    const typedRecentlyViewed = (recentItems[playlistId] || [])
        .map((item) => {
            const identity = findContentIdentity(item.id);

            if (!identity) {
                return null;
            }

            return {
                ...identity,
                viewedAt: item.viewedAt,
                ...(item.collectionItem
                    ? {
                          collectionItem: {
                              ...item.collectionItem,
                              type: identity.contentType,
                          },
                      }
                    : {}),
                ...normalizeStoredBackdrop(item),
            };
        })
        .filter(
            (
                value
            ): value is {
                contentType: 'live' | 'movie' | 'series';
                xtreamId: number;
                viewedAt: string;
            } => value !== null
        );

    return {
        hiddenCategories: [],
        favorites: typedFavorites,
        recentlyViewed: typedRecentlyViewed,
        playbackPositions,
    };
}
