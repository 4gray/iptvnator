const CHANNEL_SORT_COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

export type PortalChannelSortMode = 'server' | 'name-asc' | 'name-desc';

export const DEFAULT_PORTAL_CHANNEL_SORT_MODE: PortalChannelSortMode = 'server';

export function isPortalChannelSortMode(
    value: unknown
): value is PortalChannelSortMode {
    return value === 'server' || value === 'name-asc' || value === 'name-desc';
}

export function restorePortalChannelSortMode(
    storageKey: string,
    fallback: PortalChannelSortMode = DEFAULT_PORTAL_CHANNEL_SORT_MODE
): PortalChannelSortMode {
    const storedValue = localStorage.getItem(storageKey);
    return isPortalChannelSortMode(storedValue) ? storedValue : fallback;
}

export function persistPortalChannelSortMode(
    storageKey: string,
    mode: PortalChannelSortMode
): void {
    localStorage.setItem(storageKey, mode);
}

export function getPortalChannelSortModeLabel(
    mode: PortalChannelSortMode
): string {
    if (mode === 'name-asc') {
        return 'Name A-Z';
    }

    if (mode === 'name-desc') {
        return 'Name Z-A';
    }

    return 'Server Order';
}

export function sortPortalChannelItems<T>(
    items: readonly T[],
    mode: PortalChannelSortMode,
    getDisplayName: (item: T) => string | null | undefined
): readonly T[] {
    if (mode === 'server') {
        return items;
    }

    return [...items].sort((a, b) => {
        const result = CHANNEL_SORT_COLLATOR.compare(
            getDisplayName(a) ?? '',
            getDisplayName(b) ?? ''
        );
        return mode === 'name-asc' ? result : -result;
    });
}
