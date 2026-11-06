import {
    aggregateFavoriteChannels,
    createFavoritesPlaylist,
} from '@iptvnator/shared/m3u-utils/favorites';
import type { Playlist, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import {
    favoriteReferenceKey,
    stalkerFavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
type Favorites = NonNullable<Playlist['favorites']>;
export type PortalFavoriteItem = StalkerPortalItem & {
    category_id?: string;
    raw?: string;
    [key: string]: unknown;
};
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

export function sortedPortalFavorites(playlist: Playlist) {
    return ((playlist?.favorites ?? []) as PortalFavoriteItem[]).sort(
        (a, b) =>
            new Date(b.added_at ?? '').getTime() -
            new Date(a.added_at ?? '').getTime()
    );
}
