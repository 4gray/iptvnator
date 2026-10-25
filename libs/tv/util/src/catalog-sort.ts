export type CatalogSort = 'recent' | 'title' | 'provider';
export type CatalogSortPreferences = Record<'movie' | 'series', CatalogSort>;
export function normalizeCatalogSort(value: unknown): CatalogSort {
    return value === 'title' || value === 'provider' ? value : 'recent';
}
const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});
/** Explicit ordinal tie-break: Chromium 68 does not guarantee stable Array.sort. */
export function sortCatalog<T extends { title: string; addedAt?: number }>(
    items: T[],
    sort: CatalogSort
): T[] {
    if (sort === 'provider') return items;
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const order =
                sort === 'title'
                    ? collator.compare(a.item.title, b.item.title)
                    : (b.item.addedAt || 0) - (a.item.addedAt || 0);
            return order || a.index - b.index;
        })
        .map(({ item }) => item);
}
