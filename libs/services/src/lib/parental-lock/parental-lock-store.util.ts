import {
    ParentalLockPlaylistLocks,
    ParentalLockStalkerCategoryType,
    ParentalLockXtreamCategoryType,
} from '@iptvnator/shared/interfaces';

/**
 * Pure builders for the next lock set of one playlist: each replaces the
 * entries of ONE category type (or the M3U group list) and leaves the other
 * types untouched, so a dialog editing Live TV cannot drop the Movies locks.
 */

export function withXtreamLocks(
    current: ParentalLockPlaylistLocks,
    categoryType: ParentalLockXtreamCategoryType,
    xtreamIds: readonly number[]
): ParentalLockPlaylistLocks {
    return {
        ...current,
        xtream: [
            ...current.xtream.filter(
                (entry) => entry.categoryType !== categoryType
            ),
            ...[...new Set(xtreamIds)].map((xtreamId) => ({
                categoryType,
                xtreamId,
            })),
        ],
    };
}

export function withStalkerLocks(
    current: ParentalLockPlaylistLocks,
    categoryType: ParentalLockStalkerCategoryType,
    categoryIds: readonly string[]
): ParentalLockPlaylistLocks {
    return {
        ...current,
        stalker: [
            ...current.stalker.filter(
                (entry) => entry.categoryType !== categoryType
            ),
            ...[...new Set(categoryIds)].map((categoryId) => ({
                categoryType,
                categoryId,
            })),
        ],
    };
}

export function withM3uLocks(
    current: ParentalLockPlaylistLocks,
    groupTitles: readonly string[]
): ParentalLockPlaylistLocks {
    return { ...current, m3u: [...new Set(groupTitles)] };
}
