import {
    aggregateFavoriteChannels,
    createFavoritesPlaylist,
} from '@iptvnator/shared/m3u-utils/favorites';
import type { Playlist, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import {
    favoriteReferenceKey,
    stalkerFavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { FavoritesPlaylistBridge } from '../favorites-events';
type Favorites = NonNullable<Playlist['favorites']>;
/** Cold explicit actions only. Refresh/source documents never infer membership intent. */
export async function mutateFavoritePlaylist(
    playlist: Playlist,
    transform: (current: Favorites) => Favorites,
    bridge: FavoritesPlaylistBridge,
    persist: (playlist: Playlist) => Promise<Playlist>
): Promise<Playlist> {
    if (!playlist) throw new Error('Favorite source unavailable');
    return (
        (await bridge.mutate(playlist, transform, async (favorites) => {
            await persist({ ...playlist, favorites });
        })) ??
        persist({ ...playlist, favorites: transform(playlist.favorites ?? []) })
    );
}
export function removePortalFavorite(
    current: Favorites,
    id: number | string,
    context?: StalkerPortalItem
): Favorites {
    const reference = context && stalkerFavoriteReference(context);
    return current.filter((item) => {
        if (typeof item !== 'object') return true;
        const matchesId = [
            item.stream_id,
            item.series_id,
            item.movie_id,
            item.id,
        ].some((value) => value != null && String(value) === String(id));
        if (!matchesId) return true;
        const candidate = stalkerFavoriteReference(item);
        if (!reference) return context ? Boolean(candidate) : false;
        // Historical untyped rows use the same ID fallback as their heart.
        // Known typed rows still protect another kind or series origin.
        return Boolean(
            candidate &&
            favoriteReferenceKey(candidate) !== favoriteReferenceKey(reference)
        );
    });
}

export function globalFavoritePlaylist(playlists: Playlist[]) {
    return createFavoritesPlaylist(aggregateFavoriteChannels(playlists));
}
