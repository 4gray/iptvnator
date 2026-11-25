import type {
    XtreamBackupCollectionItem,
    XtreamBackupContentType,
    XtreamBackupFavoriteItem,
} from '@iptvnator/shared/interfaces';
import { normalizeXtreamPendingRestoreState } from '@iptvnator/shared/interfaces/xtream-restore-state';

type StoredMap = Record<string, unknown>;

interface ResolvedKey {
    key: string;
    item: { contentType: XtreamBackupContentType; xtreamId: number };
}

const CONTENT_TYPES: readonly unknown[] = ['live', 'movie', 'series'];

/** Share desktop's allowlisted snapshot fields while retaining browser cache rows. */
export function favoriteWithSnapshot(
    ref: ResolvedKey,
    saved?: XtreamBackupCollectionItem
): XtreamBackupFavoriteItem {
    if (!saved) return ref.item;
    return normalizeXtreamPendingRestoreState({
        favorites: [
            {
                ...ref.item,
                addedAt: saved['added_at'],
                position: saved['position'],
                snapshot: {
                    title: saved['title'],
                    posterUrl: saved['poster_url'],
                    backdropUrl: saved['backdrop_url'],
                    tmdbId: saved['tmdb_id'],
                    releaseYear: saved['release_year'],
                    originalTitle: saved['original_title'],
                    catalogStatus: saved['catalog_status'],
                    catalogMissingReason: saved['catalog_missing_reason'],
                },
            },
        ],
    }).favorites[0];
}

/**
 * A typed key carries its own identity. A bare provider id resolves only
 * through the snapshot stored under it, as the data source does without a
 * complete catalog: ids repeat across live, movie and series, so a guess
 * could restore a different title. An unresolvable id is left out.
 */
export function resolveKey(
    key: unknown,
    snapshots: StoredMap
): ResolvedKey | null {
    if (typeof key === 'string' && key.includes(':')) {
        const [type, id, extra] = key.split(':');
        return extra === undefined ? resolved(type, Number(id)) : null;
    }
    if (typeof key !== 'number' && typeof key !== 'string') return null;
    const snapshot = snapshots[String(key)];
    return isRecord(snapshot) && snapshot['xtream_id'] === Number(key)
        ? resolved(snapshot['type'], Number(key))
        : null;
}

function resolved(type: unknown, xtreamId: number): ResolvedKey | null {
    const key = typedKey(type, xtreamId);
    if (key === null) return null;
    const contentType = type as XtreamBackupContentType;
    return { key, item: { contentType, xtreamId } };
}

export function typedKey(type: unknown, xtreamId: unknown): string | null {
    return CONTENT_TYPES.includes(type) &&
        typeof xtreamId === 'number' &&
        Number.isSafeInteger(xtreamId) &&
        xtreamId > 0
        ? `${type}:${xtreamId}`
        : null;
}

/** Snapshots by typed key, whatever key they were stored under. */
export function snapshotsByKey(
    items: unknown[]
): Record<string, XtreamBackupCollectionItem> {
    const byKey: Record<string, XtreamBackupCollectionItem> = {};
    for (const item of items) {
        if (!isRecord(item)) continue;
        const key = typedKey(item['type'], item['xtream_id']);
        if (key !== null) byKey[key] = item as XtreamBackupCollectionItem;
    }
    return byKey;
}

function isRecord(value: unknown): value is StoredMap {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
