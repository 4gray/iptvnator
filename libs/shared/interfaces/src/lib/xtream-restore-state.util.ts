import {
    XtreamBackupCategoryType,
    XtreamBackupFavoriteItem,
    XtreamBackupHiddenCategory,
    XtreamBackupRecentlyViewedItem,
} from './playlist-backup.interface';
import { PlaybackPositionData } from './playback-position.interface';

export interface XtreamPendingRestoreState {
    hiddenCategories: XtreamBackupHiddenCategory[];
    favorites: XtreamBackupFavoriteItem[];
    recentlyViewed: XtreamBackupRecentlyViewedItem[];
    playbackPositions: PlaybackPositionData[];
}

export function getXtreamPendingRestoreStorageKey(playlistId: string): string {
    return `xtream-restore-${playlistId}`;
}

const XTREAM_BACKUP_CATEGORY_TYPES: readonly XtreamBackupCategoryType[] = [
    'live',
    'movies',
    'series',
];

interface RestoreStateCandidate {
    hiddenCategories?: unknown;
    favorites?: unknown;
    recentlyViewed?: unknown;
    playbackPositions?: unknown;
}

interface RestoreEntryCandidate {
    categoryType?: unknown;
    xtreamId?: unknown;
}

function normalizeXtreamBackupId(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

// The web build compiles this lib with lib=es2018, so Array#flatMap is not
// available here; stick to filter/map/push.
function withNumericXtreamId<T extends { xtreamId: number }>(
    items: unknown[]
): T[] {
    const result: T[] = [];

    for (const item of items) {
        if (!isRecord(item)) {
            continue;
        }

        const xtreamId = normalizeXtreamBackupId(
            (item as RestoreEntryCandidate).xtreamId
        );

        if (xtreamId === null) {
            continue;
        }

        result.push({ ...item, xtreamId } as T);
    }

    return result;
}

/**
 * Normalizes restore state coming from untrusted sources: user-supplied
 * backup files and persisted localStorage entries. Backups exported by
 * broken builds (issue #1017) contain hiddenCategories entries without an
 * xtreamId; matching such entries against real category rows would compare
 * `undefined === undefined` and hide every category of that type, so any
 * entry without a usable numeric xtreamId is dropped instead of restored.
 */
export function normalizeXtreamPendingRestoreState(
    value: unknown
): XtreamPendingRestoreState {
    if (!isRecord(value)) {
        return {
            hiddenCategories: [],
            favorites: [],
            recentlyViewed: [],
            playbackPositions: [],
        };
    }

    const candidate = value as RestoreStateCandidate;

    const hiddenCategories: XtreamBackupHiddenCategory[] = [];

    for (const item of toArray(candidate.hiddenCategories)) {
        if (!isRecord(item)) {
            continue;
        }

        const entry = item as RestoreEntryCandidate;
        const xtreamId = normalizeXtreamBackupId(entry.xtreamId);
        const categoryType = entry.categoryType as XtreamBackupCategoryType;

        if (
            xtreamId === null ||
            !XTREAM_BACKUP_CATEGORY_TYPES.includes(categoryType)
        ) {
            continue;
        }

        hiddenCategories.push({ categoryType, xtreamId });
    }

    return {
        hiddenCategories,
        favorites: withNumericXtreamId<XtreamBackupFavoriteItem>(
            toArray(candidate.favorites)
        ),
        recentlyViewed: withNumericXtreamId<XtreamBackupRecentlyViewedItem>(
            toArray(candidate.recentlyViewed)
        ),
        playbackPositions: toArray(candidate.playbackPositions).filter(
            (item): item is PlaybackPositionData => isRecord(item)
        ),
    };
}
