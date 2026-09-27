import {
    isParentalLockPlaylistLocksEmpty,
    lockedXtreamCategoryIds,
    normalizeParentalLockPlaylistLocks,
    ParentalLockPlaylistLocks,
    ParentalLockStalkerCategoryType,
    ParentalLockStore,
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

/** Whether `next` drops any lock that `previous` holds. */
export function removesParentalLocks(
    previous: ParentalLockPlaylistLocks,
    next: ParentalLockPlaylistLocks
): boolean {
    const xtream = new Set(
        next.xtream.map((lock) => `${lock.categoryType}:${lock.xtreamId}`)
    );
    const stalker = new Set(
        next.stalker.map((lock) => `${lock.categoryType}:${lock.categoryId}`)
    );
    const m3u = new Set(next.m3u);
    return (
        previous.xtream.some(
            (lock) => !xtream.has(`${lock.categoryType}:${lock.xtreamId}`)
        ) ||
        previous.stalker.some(
            (lock) => !stalker.has(`${lock.categoryType}:${lock.categoryId}`)
        ) ||
        previous.m3u.some((title) => !m3u.has(title))
    );
}

/**
 * Whether an edit from `previous` to `next` may be issued: adding locks
 * always may, removing one only while `mayRemove()` says so (logged when
 * refused). Returned as a function so the answer is taken at the moment
 * the edit's first write is issued.
 */
export function lockRemovalGate(
    previous: ParentalLockPlaylistLocks,
    next: ParentalLockPlaylistLocks,
    mayRemove: () => boolean
): () => boolean {
    const removes = removesParentalLocks(previous, next);
    return () => {
        if (!removes || mayRemove()) {
            return true;
        }
        console.warn('A parental lock edit was refused: the app is locked.');
        return false;
    };
}

/** `store` with one playlist's locks replaced; an empty set drops its key. */
export function withPlaylistLocksInStore(
    store: ParentalLockStore,
    playlistId: string,
    locks: ParentalLockPlaylistLocks
): ParentalLockStore {
    const normalized = normalizeParentalLockPlaylistLocks(locks);
    const next: ParentalLockStore = { ...store };
    if (isParentalLockPlaylistLocksEmpty(normalized)) {
        delete next[playlistId];
    } else {
        next[playlistId] = normalized;
    }
    return next;
}

/**
 * Stamps the SQLite `categories.locked` index of one playlist from `locks`,
 * type by type. Every type is attempted; false when any of them failed.
 */
export async function stampXtreamIndex(
    setCategoryLocks: (
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType,
        lockedXtreamIds: number[]
    ) => Promise<boolean>,
    playlistId: string,
    categoryTypes: readonly ParentalLockXtreamCategoryType[],
    locks: ParentalLockPlaylistLocks
): Promise<boolean> {
    let success = true;
    for (const categoryType of categoryTypes) {
        success =
            (await setCategoryLocks(
                playlistId,
                categoryType,
                lockedXtreamCategoryIds(locks, categoryType)
            )) && success;
    }
    return success;
}
