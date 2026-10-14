import {
    XtreamBackupCategoryType,
    XtreamBackupFavoriteItem,
    XtreamBackupHiddenCategory,
    XtreamBackupRecentlyViewedItem,
    XtreamBackupSourcePin,
} from './playlist-backup.interface';
import { PlaybackPositionData } from './playback-position.interface';
import { normalizeContentMetadataIdentity } from './content-metadata-identity';
import type { XtreamFavoriteSnapshot } from './xtream-favorite.interface';

export interface XtreamPendingRestoreState {
    hiddenCategories: XtreamBackupHiddenCategory[];
    favorites: XtreamBackupFavoriteItem[];
    recentlyViewed: XtreamBackupRecentlyViewedItem[];
    playbackPositions: PlaybackPositionData[];
    /**
     * Optional: absent from archives and persisted entries written before
     * multi-source existed. The normalizer preserves that absence so restore
     * can distinguish "no opinion" from an authoritative empty collection.
     */
    sourcePins?: XtreamBackupSourcePin[];
    /** Internal replay receipt; never exported in an archive. */
    favoritesRestoreId?: string;
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
    collectionItems?: unknown;
    hiddenCategories?: unknown;
    favorites?: unknown;
    recentlyViewed?: unknown;
    playbackPositions?: unknown;
    sourcePins?: unknown;
    favoritesRestoreId?: unknown;
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
        favorites: normalizeFavorites(
            candidate.favorites,
            candidate.collectionItems
        ),
        ...(typeof candidate.favoritesRestoreId === 'string' &&
        candidate.favoritesRestoreId.length > 0 &&
        candidate.favoritesRestoreId.length <= 200
            ? { favoritesRestoreId: candidate.favoritesRestoreId }
            : {}),
        recentlyViewed: withNumericXtreamId<XtreamBackupRecentlyViewedItem>(
            toArray(candidate.recentlyViewed)
        ),
        playbackPositions: toArray(candidate.playbackPositions).filter(
            (item): item is PlaybackPositionData => isRecord(item)
        ),
        // Absent stays ABSENT. Materializing `[]` here would make an older
        // archive — which says nothing about pins — look like one that says
        // "there are none", and restore would clear the user's pins.
        ...(candidate.sourcePins === undefined
            ? {}
            : { sourcePins: normalizeSourcePins(candidate.sourcePins) }),
    };
}

/**
 * A pin without a usable match key or content id cannot address anything, and
 * writing it would occupy the unique key of a film it does not describe.
 */
function normalizeSourcePins(value: unknown): XtreamBackupSourcePin[] {
    const pins: XtreamBackupSourcePin[] = [];

    for (const item of toArray(value)) {
        if (!isRecord(item)) {
            continue;
        }

        const matchKey = (item as { matchKey?: unknown }).matchKey;
        const contentId = normalizeXtreamBackupId(
            (item as { contentId?: unknown }).contentId
        );
        const updatedAt = (item as { updatedAt?: unknown }).updatedAt;

        if (typeof matchKey !== 'string' || !matchKey || contentId === null) {
            continue;
        }

        pins.push({
            matchKey,
            contentId,
            ...(typeof updatedAt === 'string' ? { updatedAt } : {}),
        });
    }

    return pins;
}

/** Allowlisted saved metadata and availability evidence, never a raw provider response. */
function normalizeFavorites(
    value: unknown,
    collectionItems: unknown
): XtreamBackupFavoriteItem[] {
    const cache = new Map(
        toArray(collectionItems)
            .filter(isRecord)
            .map((item) => [
                `${item['type']}:${normalizeXtreamBackupId(item['xtream_id'])}`,
                item,
            ])
    );
    return withNumericXtreamId<XtreamBackupFavoriteItem>(toArray(value))
        .filter((item) =>
            ['live', 'movie', 'series'].includes(item.contentType)
        )
        .map((item) => {
            const snapshot = normalizeFavoriteSnapshot(item.snapshot);
            const stored = cache.get(`${item.contentType}:${item.xtreamId}`);
            if (snapshot && !snapshot.catalogStatus && stored) {
                const identity = normalizeContentMetadataIdentity({
                    tmdbId: stored['tmdb_id'],
                    releaseYear: stored['release_year'],
                });
                // Old browser archives kept availability only in the optional cache.
                // Promote it before parking pending state, but never from another identity.
                if (
                    (snapshot.tmdbId == null ||
                        snapshot.tmdbId === identity.tmdbId) &&
                    (snapshot.releaseYear == null ||
                        snapshot.releaseYear === identity.releaseYear)
                )
                    copySnapshotAvailability(
                        snapshot,
                        stored['catalog_status'],
                        stored['catalog_missing_reason']
                    );
            }
            return {
                contentType: item.contentType,
                xtreamId: item.xtreamId,
                ...(typeof item.addedAt === 'string'
                    ? { addedAt: item.addedAt }
                    : {}),
                ...(item.position === null ||
                (typeof item.position === 'number' &&
                    Number.isFinite(item.position))
                    ? { position: item.position }
                    : {}),
                ...(snapshot ? { snapshot } : {}),
            };
        });
}

function normalizeFavoriteSnapshot(
    value: unknown
): XtreamFavoriteSnapshot | undefined {
    if (
        !isRecord(value) ||
        typeof value['title'] !== 'string' ||
        !value['title'].trim()
    )
        return undefined;
    const snapshot: XtreamFavoriteSnapshot = { title: value['title'].trim() };
    for (const key of ['posterUrl', 'backdropUrl', 'originalTitle'] as const) {
        const field = value[key];
        if (typeof field === 'string') snapshot[key] = field;
        else if (field === null) snapshot[key] = null;
    }
    const identity = normalizeContentMetadataIdentity(value);
    for (const key of ['tmdbId', 'releaseYear'] as const) {
        const field = value[key];
        const normalized =
            typeof field === 'number' || typeof field === 'string'
                ? identity[key]
                : undefined;
        if (normalized !== undefined) snapshot[key] = normalized;
        else if (field === null) snapshot[key] = null;
    }
    copySnapshotAvailability(
        snapshot,
        value['catalogStatus'],
        value['catalogMissingReason']
    );
    return snapshot;
}

function copySnapshotAvailability(
    snapshot: XtreamFavoriteSnapshot,
    status: unknown,
    reason: unknown
): void {
    if (status !== 'present' && status !== 'missing' && status !== 'unknown')
        return;
    snapshot.catalogStatus = status;
    if (
        status === 'missing' &&
        (reason === 'absent' || reason === 'identity_conflict')
    )
        snapshot.catalogMissingReason = reason;
}
