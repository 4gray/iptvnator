import { foldSearchText } from '@iptvnator/shared/interfaces';
import { ContentType } from '../../xtream-state';
import {
    XtreamCategorySortMode,
    XtreamSelectionItem,
} from './with-selection.models';
const COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});
const parseRatingValue = (value: unknown): number | null => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value.trim());
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

/**
 * Numeric IMDb-style rating used for sorting/filtering. Mirrors the grid badge
 * (prefers `rating_imdb`, falls back to the generic `rating`), checking the
 * stream-list shape first and the nested `info` object as a fallback. Returns
 * null when no parseable rating exists.
 */
export const getNumericRating = (item: XtreamSelectionItem): number | null => {
    const info =
        item.info && !Array.isArray(item.info)
            ? (item.info as Record<string, unknown>)
            : null;
    const record = item as Record<string, unknown>;
    for (const field of ['rating_imdb', 'rating'] as const) {
        const direct = parseRatingValue(record[field]);
        if (direct !== null) {
            return direct;
        }
        const nested = info ? parseRatingValue(info[field]) : null;
        if (nested !== null) {
            return nested;
        }
    }
    return null;
};

/**
 * Filter VOD/series items by a minimum IMDb rating. Unrated items are excluded
 * while a threshold is active.
 */
export const filterByMinRating = (
    items: XtreamSelectionItem[],
    minRating: number | null
): XtreamSelectionItem[] => {
    if (minRating === null || minRating <= 0) {
        return items;
    }
    return items.filter((item) => {
        const rating = getNumericRating(item);
        return rating !== null && rating >= minRating;
    });
};

const getItemDate = (
    item: XtreamSelectionItem,
    categoryType: ContentType
): number => {
    const value =
        categoryType === 'series'
            ? (item.last_modified ?? item.added)
            : item.added;
    return parseInt(value ?? '', 10) || 0;
};

export const sortByMode = (
    items: XtreamSelectionItem[],
    sortMode: XtreamCategorySortMode,
    categoryType: ContentType
): XtreamSelectionItem[] => {
    return [...items].sort((a, b) => {
        if (sortMode === 'date-desc') {
            return getItemDate(b, categoryType) - getItemDate(a, categoryType);
        }
        if (sortMode === 'date-asc') {
            return getItemDate(a, categoryType) - getItemDate(b, categoryType);
        }

        if (sortMode === 'rating-desc' || sortMode === 'rating-asc') {
            const ratingA = getNumericRating(a);
            const ratingB = getNumericRating(b);
            // Unrated items always sink to the bottom, regardless
            // of sort direction.
            if (ratingA === null || ratingB === null) {
                if (ratingA !== ratingB) {
                    return ratingA === null ? 1 : -1;
                }
            } else if (ratingA !== ratingB) {
                return sortMode === 'rating-desc'
                    ? ratingB - ratingA
                    : ratingA - ratingB;
            }
            // Equal ratings (or both unrated): alphabetical tiebreak.
            const ratingTitleA = a.title ?? a.name ?? '';
            const ratingTitleB = b.title ?? b.name ?? '';
            return COLLATOR.compare(ratingTitleA, ratingTitleB);
        }

        const titleA = a.title ?? a.name ?? '';
        const titleB = b.title ?? b.name ?? '';
        const byName = COLLATOR.compare(titleA, titleB);
        return sortMode === 'name-asc' ? byName : -byName;
    });
};

export const filterBySearchTerm = (
    items: XtreamSelectionItem[],
    searchTerm: string
): XtreamSelectionItem[] => {
    const normalized = foldSearchText(searchTerm.trim());
    if (!normalized) {
        return items;
    }

    return items.filter((item) => {
        const title = (item.title ?? item.name ?? '').toString();
        return foldSearchText(title).includes(normalized);
    });
};

export const buildCountMap = (
    streams: XtreamSelectionItem[]
): Map<number, number> => {
    const countMap = new Map<number, number>();
    for (const item of streams) {
        const catId = Number(item.category_id);
        if (!isNaN(catId)) {
            countMap.set(catId, (countMap.get(catId) || 0) + 1);
        }
    }
    return countMap;
};
