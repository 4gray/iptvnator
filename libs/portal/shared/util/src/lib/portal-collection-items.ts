import { XtreamCategory } from '@iptvnator/shared/interfaces';

type StandardCollectionBucket = 'all' | 'movie' | 'live' | 'series';

interface BuildStandardCollectionCategoriesOptions {
    labels: Record<StandardCollectionBucket, string>;
    counts: Partial<Record<StandardCollectionBucket, number>>;
    includeLive?: boolean;
    liveCategoryId?: 'itv' | 'live';
}

interface FilterCollectionBucketOptions<T> {
    selectedCategoryId: string | null | undefined;
    allItems: readonly T[] | null | undefined;
    buckets: Partial<Record<'movie' | 'live' | 'series', readonly T[] | null | undefined>>;
    searchTerm?: string | null | undefined;
    liveCategoryId?: string;
    textOf: (item: T) => string;
}

export function buildStandardCollectionCategories(
    options: BuildStandardCollectionCategoriesOptions
): XtreamCategory[] {
    const {
        labels,
        counts,
        includeLive = false,
        liveCategoryId = 'live',
    } = options;
    const categories: XtreamCategory[] = [
        {
            id: 1,
            category_id: 'all',
            category_name: labels.all,
            count: counts.all ?? 0,
            parent_id: 0,
        },
        {
            id: 2,
            category_id: 'movie',
            category_name: labels.movie,
            count: counts.movie ?? 0,
            parent_id: 0,
        },
    ];

    if (includeLive) {
        categories.push({
            id: 3,
            category_id: liveCategoryId,
            category_name: labels.live,
            count: counts.live ?? 0,
            parent_id: 0,
        });
    }

    categories.push({
        id: includeLive ? 4 : 3,
        category_id: 'series',
        category_name: labels.series,
        count: counts.series ?? 0,
        parent_id: 0,
    });

    return categories;
}

export function filterCollectionBucket<T>(
    options: FilterCollectionBucketOptions<T>
): T[] {
    const {
        selectedCategoryId,
        allItems,
        buckets,
        searchTerm,
        liveCategoryId = 'live',
        textOf,
    } = options;
    const baseItems =
        selectedCategoryId === 'movie'
            ? buckets.movie ?? []
            : selectedCategoryId === liveCategoryId
              ? buckets.live ?? []
              : selectedCategoryId === 'series'
                ? buckets.series ?? []
                : allItems ?? [];
    const normalizedTerm = (searchTerm ?? '').trim().toLowerCase();

    if (!normalizedTerm) {
        return [...baseItems];
    }

    return baseItems.filter((item) =>
        String(textOf(item)).toLowerCase().includes(normalizedTerm)
    );
}
