import type { Media, UserData } from '@iptvnator/tv/util';

/** Shared members with a resolved item; local favorites are never included. */
export function sharedFavoriteMedia(data: UserData): Media[] {
    return Object.values(data.sharedFavorites)
        .filter((entry) => entry.record.state.member)
        .map((entry) => entry.media)
        .filter((media): media is Media => !!media);
}

export function isSharedFavorite(data: UserData, item: Media): boolean {
    return Object.values(data.sharedFavorites).some(
        (entry) => entry.record.state.member && entry.media?.id === item.id
    );
}

/** Displayed saved state: local favorites, plus shared members in shared mode. */
export function isFavoriteItem(data: UserData, item: Media): boolean {
    return (
        data.favorites.some((m) => m.id === item.id) ||
        (data.favoritesMode === 'shared' && isSharedFavorite(data, item))
    );
}

/**
 * The favorites projection: local favorites, plus shared members that are not
 * already local and whose source is still linked.
 */
export function favoriteItems(data: UserData): Media[] {
    if (data.favoritesMode !== 'shared') return data.favorites;
    return [
        ...data.favorites,
        ...sharedFavoriteMedia(data).filter(
            (m) =>
                data.sources.some((s) => s.id === m.sourceId) &&
                !data.favorites.some((local) => local.id === m.id)
        ),
    ];
}

export function sharedFavoriteCounts(data: UserData) {
    let members = 0;
    let pending = 0;
    let conflicts = 0;
    for (const entry of Object.values(data.sharedFavorites)) {
        if (entry.record.state.member) members++;
        pending += entry.record.pending.length;
        if (entry.record.conflict) conflicts++;
    }
    return { members, pending, conflicts };
}
