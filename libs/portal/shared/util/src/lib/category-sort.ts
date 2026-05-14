const CATEGORY_SORT_COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

export type PortalCategorySortMode = 'server' | 'name-asc' | 'name-desc';

export const DEFAULT_PORTAL_CATEGORY_SORT_MODE: PortalCategorySortMode =
    'server';

export const WORKSPACE_CATEGORY_SORT_STORAGE_KEY =
    'workspace-category-sort-mode';

export function isPortalCategorySortMode(
    value: unknown
): value is PortalCategorySortMode {
    return value === 'server' || value === 'name-asc' || value === 'name-desc';
}

export function restorePortalCategorySortMode(
    storageKey: string = WORKSPACE_CATEGORY_SORT_STORAGE_KEY,
    fallback: PortalCategorySortMode = DEFAULT_PORTAL_CATEGORY_SORT_MODE
): PortalCategorySortMode {
    const storedValue = localStorage.getItem(storageKey);
    return isPortalCategorySortMode(storedValue) ? storedValue : fallback;
}

export function persistPortalCategorySortMode(
    mode: PortalCategorySortMode,
    storageKey: string = WORKSPACE_CATEGORY_SORT_STORAGE_KEY
): void {
    localStorage.setItem(storageKey, mode);
}

export function sortPortalCategoryItems<T>(
    items: readonly T[],
    mode: PortalCategorySortMode,
    getDisplayName: (item: T) => string | null | undefined,
    isPinnedFirst: (item: T) => boolean = () => false
): readonly T[] {
    if (mode === 'server') {
        return items;
    }

    const pinnedItems = items.filter(isPinnedFirst);
    const sortableItems = items.filter((item) => !isPinnedFirst(item));

    return pinnedItems.concat(
        sortableItems.sort((a, b) => {
            const result = CATEGORY_SORT_COLLATOR.compare(
                (getDisplayName(a) ?? '').trim(),
                (getDisplayName(b) ?? '').trim()
            );
            return mode === 'name-asc' ? result : -result;
        })
    );
}
