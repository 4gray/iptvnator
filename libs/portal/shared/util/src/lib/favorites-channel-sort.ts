const FAVORITES_SORT_COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

export type FavoritesChannelSortMode =
    | 'custom'
    | 'name-asc'
    | 'name-desc'
    | 'date-desc';

export const DEFAULT_FAVORITES_CHANNEL_SORT_MODE: FavoritesChannelSortMode =
    'custom';

export const FAVORITES_CHANNEL_SORT_STORAGE_KEY =
    'favorites-channel-sort-mode';

export function isFavoritesChannelSortMode(
    value: unknown
): value is FavoritesChannelSortMode {
    return (
        value === 'custom' ||
        value === 'name-asc' ||
        value === 'name-desc' ||
        value === 'date-desc'
    );
}

export function restoreFavoritesChannelSortMode(
    storageKey: string = FAVORITES_CHANNEL_SORT_STORAGE_KEY,
    fallback: FavoritesChannelSortMode = DEFAULT_FAVORITES_CHANNEL_SORT_MODE
): FavoritesChannelSortMode {
    const storedValue = localStorage.getItem(storageKey);
    return isFavoritesChannelSortMode(storedValue) ? storedValue : fallback;
}

export function persistFavoritesChannelSortMode(
    mode: FavoritesChannelSortMode,
    storageKey: string = FAVORITES_CHANNEL_SORT_STORAGE_KEY
): void {
    localStorage.setItem(storageKey, mode);
}

export function getFavoritesChannelSortModeTranslationKey(
    mode: FavoritesChannelSortMode
): string {
    switch (mode) {
        case 'name-asc':
            return 'WORKSPACE.SORT_NAME_ASC';
        case 'name-desc':
            return 'WORKSPACE.SORT_NAME_DESC';
        case 'date-desc':
            return 'WORKSPACE.SORT_DATE_DESC';
        default:
            return 'WORKSPACE.SORT_CUSTOM';
    }
}

export function sortFavoriteChannelItems<T>(
    items: readonly T[],
    mode: FavoritesChannelSortMode,
    accessors: {
        getName: (item: T) => string | null | undefined;
        getAddedAt?: (item: T) => string | null | undefined;
    }
): readonly T[] {
    if (mode === 'custom') {
        return items;
    }

    if (mode === 'date-desc') {
        const getAddedAt = accessors.getAddedAt;
        if (!getAddedAt) {
            return items;
        }
        return [...items].sort((a, b) => {
            const timeA = Date.parse(getAddedAt(a) ?? '') || 0;
            const timeB = Date.parse(getAddedAt(b) ?? '') || 0;
            return timeB - timeA;
        });
    }

    return [...items].sort((a, b) => {
        const result = FAVORITES_SORT_COLLATOR.compare(
            accessors.getName(a) ?? '',
            accessors.getName(b) ?? ''
        );
        return mode === 'name-asc' ? result : -result;
    });
}
