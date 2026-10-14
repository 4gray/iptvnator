import { SortBy, SortOptions, SortOrder } from '@iptvnator/services';

export interface SourceSortOption {
    by: SortBy;
    order: SortOrder;
    translationKey: string;
}

/** The Sources sort menu, in menu order. Custom order allows dragging. */
export const SOURCE_SORT_OPTIONS: readonly SourceSortOption[] = [
    {
        by: SortBy.DATE_ADDED,
        order: SortOrder.DESC,
        translationKey: 'HOME.SORT_OPTIONS.NEWEST',
    },
    {
        by: SortBy.DATE_ADDED,
        order: SortOrder.ASC,
        translationKey: 'HOME.SORT_OPTIONS.OLDEST',
    },
    {
        by: SortBy.UPDATED,
        order: SortOrder.DESC,
        translationKey: 'HOME.SORT_OPTIONS.UPDATED',
    },
    {
        by: SortBy.NAME,
        order: SortOrder.ASC,
        translationKey: 'HOME.SORT_OPTIONS.NAME_ASC',
    },
    {
        by: SortBy.NAME,
        order: SortOrder.DESC,
        translationKey: 'HOME.SORT_OPTIONS.NAME_DESC',
    },
    {
        by: SortBy.CHANNELS,
        order: SortOrder.DESC,
        translationKey: 'HOME.SORT_OPTIONS.CHANNELS',
    },
    {
        by: SortBy.CUSTOM,
        order: SortOrder.ASC,
        translationKey: 'HOME.SORT_OPTIONS.CUSTOM_ORDER',
    },
];

export function isSortOptionActive(
    option: SourceSortOption,
    current: SortOptions
): boolean {
    return option.by === current.by && option.order === current.order;
}
