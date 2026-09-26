/**
 * Parental lock contracts shared by the renderer service, the Electron DB
 * worker (which stamps Xtream locks onto `categories.locked`) and the
 * playlist backup format.
 *
 * The unit of locking is the CATEGORY: an Xtream category (by provider
 * `category_id`, stable across refreshes), a Stalker genre (by portal id) or
 * an M3U `group-title`. The renderer keeps every lock in one store keyed by
 * playlist id; the SQLite column is only a query index derived from it.
 */

export type ParentalLockPortalType = 'xtream' | 'stalker' | 'm3u';

/** Xtream category table types (`categories.type`). */
export type ParentalLockXtreamCategoryType = 'live' | 'movies' | 'series';

/** Stalker content sections that carry their own genre list. */
export type ParentalLockStalkerCategoryType =
    'itv' | 'vod' | 'series' | 'radio';

export interface ParentalLockXtreamCategory {
    categoryType: ParentalLockXtreamCategoryType;
    xtreamId: number;
}

export interface ParentalLockStalkerCategory {
    categoryType: ParentalLockStalkerCategoryType;
    categoryId: string;
}

export interface ParentalLockPlaylistLocks {
    xtream: ParentalLockXtreamCategory[];
    stalker: ParentalLockStalkerCategory[];
    /** Locked M3U `group-title` values, exact match. */
    m3u: string[];
}

/** Every locked category, keyed by playlist id. */
export type ParentalLockStore = Record<string, ParentalLockPlaylistLocks>;

/** Storage key for the lock store (Electron `app_state`, PWA localStorage). */
export const PARENTAL_LOCK_STORE_KEY = 'parental-lock:locks';
/** Storage key for the hashed PIN — deliberately outside `Settings`. */
export const PARENTAL_LOCK_PIN_KEY = 'parental-lock:pin';

export const PARENTAL_LOCK_XTREAM_CATEGORY_TYPES: readonly ParentalLockXtreamCategoryType[] =
    ['live', 'movies', 'series'];
export const PARENTAL_LOCK_STALKER_CATEGORY_TYPES: readonly ParentalLockStalkerCategoryType[] =
    ['itv', 'vod', 'series', 'radio'];

/**
 * A "withheld categories" set that withholds EVERY category. Used while the
 * lock is active but the lock store could not be read: consumers keep their
 * `size`/`has` checks and simply find nothing they may show.
 */
export const ALL_CATEGORIES_WITHHELD: ReadonlySet<string> = Object.freeze(
    new (class extends Set<string> {
        override has(): boolean {
            return true;
        }
        override get size(): number {
            return 1;
        }
    })()
);

export function createEmptyParentalLockPlaylistLocks(): ParentalLockPlaylistLocks {
    return { xtream: [], stalker: [], m3u: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function normalizeNumericId(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

export function normalizeParentalLockXtreamCategories(
    value: unknown
): ParentalLockXtreamCategory[] {
    const seen = new Set<string>();
    const result: ParentalLockXtreamCategory[] = [];
    for (const item of toArray(value)) {
        if (!isRecord(item)) {
            continue;
        }
        const categoryType = item[
            'categoryType'
        ] as ParentalLockXtreamCategoryType;
        const xtreamId = normalizeNumericId(item['xtreamId']);
        if (
            xtreamId === null ||
            !PARENTAL_LOCK_XTREAM_CATEGORY_TYPES.includes(categoryType)
        ) {
            continue;
        }
        const key = `${categoryType}:${xtreamId}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push({ categoryType, xtreamId });
    }
    return result;
}

export function normalizeParentalLockStalkerCategories(
    value: unknown
): ParentalLockStalkerCategory[] {
    const seen = new Set<string>();
    const result: ParentalLockStalkerCategory[] = [];
    for (const item of toArray(value)) {
        if (!isRecord(item)) {
            continue;
        }
        const categoryType = item[
            'categoryType'
        ] as ParentalLockStalkerCategoryType;
        const rawId = item['categoryId'];
        const categoryId =
            typeof rawId === 'string'
                ? rawId.trim()
                : typeof rawId === 'number' && Number.isFinite(rawId)
                  ? String(rawId)
                  : '';
        if (
            !categoryId ||
            categoryId === '*' ||
            !PARENTAL_LOCK_STALKER_CATEGORY_TYPES.includes(categoryType)
        ) {
            continue;
        }
        const key = `${categoryType}:${categoryId}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push({ categoryType, categoryId });
    }
    return result;
}

function isWellFormedList(
    value: unknown,
    isWellFormedEntry: (entry: unknown) => boolean
): boolean {
    return Array.isArray(value) && value.every(isWellFormedEntry);
}

/**
 * Whether a persisted store has the shape `writeLocks` produces: every
 * playlist entry an object whose `xtream`/`stalker`/`m3u` lists are all
 * present (a missing list is corruption, not "empty") and hold only
 * entries the normalizers accept. The normalizers DROP what they
 * do not understand, which is right for user-supplied backups but turns a
 * corrupted persisted store into "nothing is locked"; a store that fails
 * this check is treated as unreadable instead.
 */
export function isWellFormedParentalLockStore(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    return Object.values(value).every(
        (locks) =>
            isRecord(locks) &&
            isWellFormedList(
                locks['xtream'],
                (entry) =>
                    isRecord(entry) &&
                    PARENTAL_LOCK_XTREAM_CATEGORY_TYPES.includes(
                        entry['categoryType'] as ParentalLockXtreamCategoryType
                    ) &&
                    normalizeNumericId(entry['xtreamId']) !== null
            ) &&
            isWellFormedList(
                locks['stalker'],
                (entry) =>
                    isRecord(entry) &&
                    PARENTAL_LOCK_STALKER_CATEGORY_TYPES.includes(
                        entry['categoryType'] as ParentalLockStalkerCategoryType
                    ) &&
                    ((typeof entry['categoryId'] === 'string' &&
                        entry['categoryId'].trim() !== '' &&
                        entry['categoryId'].trim() !== '*') ||
                        (typeof entry['categoryId'] === 'number' &&
                            Number.isFinite(entry['categoryId'])))
            ) &&
            isWellFormedList(locks['m3u'], (entry) => typeof entry === 'string')
    );
}

export function normalizeParentalLockGroupTitles(value: unknown): string[] {
    const seen = new Set<string>();
    for (const item of toArray(value)) {
        if (typeof item === 'string') {
            seen.add(item);
        }
    }
    return [...seen];
}

export function normalizeParentalLockPlaylistLocks(
    value: unknown
): ParentalLockPlaylistLocks {
    if (!isRecord(value)) {
        return createEmptyParentalLockPlaylistLocks();
    }
    return {
        xtream: normalizeParentalLockXtreamCategories(value['xtream']),
        stalker: normalizeParentalLockStalkerCategories(value['stalker']),
        m3u: normalizeParentalLockGroupTitles(value['m3u']),
    };
}

export function isParentalLockPlaylistLocksEmpty(
    locks: ParentalLockPlaylistLocks
): boolean {
    return (
        locks.xtream.length === 0 &&
        locks.stalker.length === 0 &&
        locks.m3u.length === 0
    );
}

/**
 * Normalizes a persisted or user-supplied lock store. Entries that lock
 * nothing are dropped so the store never grows with empty playlists.
 */
export function normalizeParentalLockStore(value: unknown): ParentalLockStore {
    const store: ParentalLockStore = {};
    if (!isRecord(value)) {
        return store;
    }
    for (const [playlistId, locks] of Object.entries(value)) {
        if (!playlistId) {
            continue;
        }
        const normalized = normalizeParentalLockPlaylistLocks(locks);
        if (!isParentalLockPlaylistLocksEmpty(normalized)) {
            store[playlistId] = normalized;
        }
    }
    return store;
}

export function lockedXtreamCategoryIds(
    locks: ParentalLockPlaylistLocks | undefined,
    categoryType: ParentalLockXtreamCategoryType
): number[] {
    return (locks?.xtream ?? [])
        .filter((entry) => entry.categoryType === categoryType)
        .map((entry) => entry.xtreamId);
}

export function lockedStalkerCategoryIds(
    locks: ParentalLockPlaylistLocks | undefined,
    categoryType: ParentalLockStalkerCategoryType
): string[] {
    return (locks?.stalker ?? [])
        .filter((entry) => entry.categoryType === categoryType)
        .map((entry) => entry.categoryId);
}

/** Maps a Stalker section id to the genre list it locks against. */
export function toParentalLockStalkerCategoryType(
    section: string | null | undefined
): ParentalLockStalkerCategoryType | null {
    switch (section) {
        case 'itv':
        case 'vod':
        case 'series':
        case 'radio':
            return section;
        default:
            return null;
    }
}

/** Maps an Xtream route section (`live`/`vod`/`series`) to the DB category type. */
export function toParentalLockXtreamCategoryType(
    section: string | null | undefined
): ParentalLockXtreamCategoryType | null {
    switch (section) {
        case 'live':
            return 'live';
        case 'vod':
        case 'movies':
            return 'movies';
        case 'series':
            return 'series';
        default:
            return null;
    }
}
