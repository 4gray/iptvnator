import { toXtreamRecentlyAddedTimestamp } from '@iptvnator/shared/interfaces';

export interface XtreamLiveChannelItem {
    readonly added?: string;
    readonly category_id?: string | number;
    readonly last_modified?: string;
    readonly name?: string;
    readonly poster_url?: string;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly tv_archive?: number | null;
    readonly tv_archive_duration?: number | string | null;
    readonly xtream_id: number;
}

interface XtreamLiveCategoryItem {
    readonly category_id?: string | number;
    readonly id?: string | number;
}

export function getRecentlyAddedLiveItems(
    liveStreams: readonly XtreamLiveChannelItem[],
    categories: readonly XtreamLiveCategoryItem[] | null | undefined,
    nowMs: number,
    limit = 20
): XtreamLiveChannelItem[] {
    const visibleCategoryIds = getVisibleCategoryIds(categories);
    if (visibleCategoryIds.size === 0) {
        return [];
    }

    return liveStreams
        .filter((item) =>
            visibleCategoryIds.has(String(item.category_id ?? ''))
        )
        .map((item) => ({
            item,
            sortTimestamp: getRecentlyAddedTimestamp(item, nowMs),
        }))
        .filter(({ sortTimestamp }) => sortTimestamp > 0)
        .sort((a, b) => b.sortTimestamp - a.sortTimestamp)
        .slice(0, limit)
        .map(({ item }) => item);
}

function getVisibleCategoryIds(
    categories: readonly XtreamLiveCategoryItem[] | null | undefined
): Set<string> {
    return new Set(
        (categories ?? [])
            .map((category) => category.category_id ?? category.id)
            .filter(
                (categoryId): categoryId is string | number =>
                    categoryId !== null && categoryId !== undefined
            )
            .map((categoryId) => String(categoryId))
    );
}

function getRecentlyAddedTimestamp(
    item: XtreamLiveChannelItem,
    nowMs: number
): number {
    return (
        toXtreamRecentlyAddedTimestamp(item.added, nowMs) ||
        toXtreamRecentlyAddedTimestamp(item.last_modified, nowMs)
    );
}
