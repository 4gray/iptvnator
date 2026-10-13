const CHANNEL_LIST_SORT_COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

export type PlaylistChannelSortMode = 'server' | 'name-asc' | 'name-desc';

export function isPlaylistChannelSortMode(
    value: unknown
): value is PlaylistChannelSortMode {
    return value === 'server' || value === 'name-asc' || value === 'name-desc';
}

export function restorePlaylistChannelSortMode(
    storageKey: string,
    fallback: PlaylistChannelSortMode = 'server'
): PlaylistChannelSortMode {
    const storedValue = localStorage.getItem(storageKey);
    return isPlaylistChannelSortMode(storedValue) ? storedValue : fallback;
}

export function persistPlaylistChannelSortMode(
    storageKey: string,
    mode: PlaylistChannelSortMode
): void {
    localStorage.setItem(storageKey, mode);
}

/** Translation key of the sort mode's menu label. */
export function getPlaylistChannelSortModeLabelKey(
    mode: PlaylistChannelSortMode
): string {
    if (mode === 'name-asc') {
        return 'WORKSPACE.SORT_NAME_ASC';
    }

    if (mode === 'name-desc') {
        return 'WORKSPACE.SORT_NAME_DESC';
    }

    return 'CHANNELS.SORT_PLAYLIST_ORDER';
}

export function sortPlaylistChannelItems<T>(
    items: readonly T[],
    mode: PlaylistChannelSortMode,
    getDisplayName: (item: T) => string | null | undefined
): readonly T[] {
    if (mode === 'server') {
        return items;
    }

    return [...items].sort((a, b) => {
        const result = CHANNEL_LIST_SORT_COLLATOR.compare(
            getDisplayName(a) ?? '',
            getDisplayName(b) ?? ''
        );
        return mode === 'name-asc' ? result : -result;
    });
}
