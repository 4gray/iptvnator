import type { XtreamBackupHiddenCategory } from './playlist-backup.interface';

export const XTREAM_CATEGORY_VISIBILITY_PREFIX = 'xtream-category-visibility:';
export const xtreamCategoryVisibilityKey = (playlistId: string) =>
    XTREAM_CATEGORY_VISIBILITY_PREFIX + playlistId;

export interface XtreamCategoryVisibility {
    version: 1;
    categories: (XtreamBackupHiddenCategory & { hidden: boolean })[];
}

/** Native explicit choices must never be confused with partial-import defaults. */
export function parseXtreamCategoryVisibility(
    raw: string
): XtreamCategoryVisibility {
    const value = JSON.parse(raw) as XtreamCategoryVisibility;
    if (
        value?.version !== 1 ||
        !Array.isArray(value.categories) ||
        !value.categories.every(
            (row) =>
                row &&
                ['live', 'movies', 'series'].includes(row.categoryType) &&
                typeof row.xtreamId === 'number' &&
                Number.isFinite(row.xtreamId) &&
                typeof row.hidden === 'boolean'
        )
    )
        throw new Error('Explicit category visibility is unreadable.');
    return value;
}
