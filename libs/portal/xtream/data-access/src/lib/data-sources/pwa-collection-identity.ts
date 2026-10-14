import { normalizeContentMetadataPatch } from '@iptvnator/shared/interfaces';
import {
    TypedXtreamCollectionRef,
    XtreamCollectionRef,
    XTREAM_CONTENT_TYPES,
    XtreamContentItem,
} from './xtream-data-source.interface';

export type CollectionKey = number | string;
export interface StoredRecentItem {
    readonly id: CollectionKey;
    readonly viewedAt: string;
    readonly backdropUrl?: string;
    readonly collectionItem?: XtreamContentItem;
}

export function typedCollectionRef(
    value: unknown
): TypedXtreamCollectionRef | null {
    if (typeof value === 'string') {
        const [type, id, extra] = value.split(':');
        return extra === undefined && id !== undefined
            ? typedCollectionRef({ type, id: Number(id) })
            : null;
    }
    if (!value || typeof value !== 'object') return null;
    const ref = value as Partial<TypedXtreamCollectionRef>;
    return ref.type !== undefined &&
        typeof ref.id === 'number' &&
        XTREAM_CONTENT_TYPES.includes(ref.type) &&
        Number.isSafeInteger(ref.id) &&
        ref.id > 0
        ? { type: ref.type, id: ref.id }
        : null;
}

export function collectionKey(value: unknown): CollectionKey | null {
    const typed = typedCollectionRef(value);
    if (typed) return `${typed.type}:${typed.id}`;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function itemCollectionKey(
    item: XtreamContentItem
): CollectionKey | null {
    return item ? collectionKey({ id: item.xtream_id, type: item.type }) : null;
}

export function normalizeFavoriteStorage(
    value: unknown
): Record<string, CollectionKey[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized: Record<string, CollectionKey[]> = {};
    for (const [playlistId, ids] of Object.entries(value)) {
        if (!Array.isArray(ids)) continue;
        normalized[playlistId] = [
            ...new Set(
                ids
                    .map(collectionKey)
                    .filter((id): id is CollectionKey => id !== null)
            ),
        ];
    }
    return normalized;
}

export function normalizeStoredBackdrop(item: {
    readonly backdropUrl?: unknown;
    readonly backdrop_url?: unknown;
}): Pick<StoredRecentItem, 'backdropUrl'> {
    const value = item.backdropUrl ?? item.backdrop_url;
    return typeof value === 'string' && value.trim()
        ? { backdropUrl: value.trim() }
        : {};
}

export function normalizeRecentStorage(
    value: unknown
): Record<string, StoredRecentItem[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized: Record<string, StoredRecentItem[]> = {};
    for (const [playlistId, items] of Object.entries(value)) {
        if (!Array.isArray(items)) continue;
        normalized[playlistId] = [];
        for (const item of items as (Partial<StoredRecentItem> | null)[]) {
            const id = collectionKey(item?.id);
            if (id !== null && typeof item?.viewedAt === 'string') {
                normalized[playlistId].push({
                    id,
                    viewedAt: item.viewedAt,
                    ...normalizeStoredBackdrop(item),
                    ...(item?.collectionItem &&
                    typeof item.collectionItem.title === 'string' &&
                    (itemCollectionKey(item.collectionItem) === id ||
                        (typeof id === 'number' &&
                            item.collectionItem.xtream_id === id &&
                            itemCollectionKey(item.collectionItem) !== null))
                        ? { collectionItem: item.collectionItem }
                        : {}),
                });
            }
        }
    }
    return normalized;
}

/** Never infer a legacy number from a partially loaded catalog. */
export function findCollectionItems(
    ids: readonly CollectionKey[],
    cached: readonly XtreamContentItem[],
    snapshots: Record<string, XtreamContentItem>,
    completeCatalog: boolean
): Map<CollectionKey, XtreamContentItem> {
    const wantedIds = new Set(
        ids.map((key) => typedCollectionRef(key)?.id ?? key)
    );
    const typedItems = new Map<CollectionKey, XtreamContentItem>();
    // Stored aliases are not fresh catalog evidence. Prefer the canonical typed
    // snapshot, including any conflict retained since its legacy alias was copied.
    for (const [storedKey, item] of Object.entries(snapshots)) {
        if (!item || !wantedIds.has(item.xtream_id)) continue;
        const key = itemCollectionKey(item);
        if (key !== null && (storedKey === key || !typedItems.has(key))) {
            typedItems.set(key, item);
        }
    }
    for (const item of cached) {
        if (!item || !wantedIds.has(item.xtream_id)) continue;
        const key = itemCollectionKey(item);
        if (key !== null)
            typedItems.set(key, mergeCollectionItem(typedItems.get(key), item));
    }
    const uniqueIds = new Map<number, XtreamContentItem | null>();
    for (const item of cached) {
        if (!wantedIds.has(item.xtream_id)) continue;
        const previous = uniqueIds.get(item.xtream_id);
        uniqueIds.set(
            item.xtream_id,
            previous === null || (previous && previous.type !== item.type)
                ? null
                : item
        );
    }
    const results = new Map<CollectionKey, XtreamContentItem>();
    for (const key of ids) {
        if (typeof key === 'string') {
            const item = typedItems.get(key);
            if (item) results.set(key, item);
            continue;
        }
        const snapshot = snapshots[String(key)];
        const snapshotKey = snapshot ? itemCollectionKey(snapshot) : null;
        if (snapshot && snapshot.xtream_id === key && snapshotKey !== null) {
            results.set(key, typedItems.get(snapshotKey) ?? snapshot);
        } else if (completeCatalog) {
            const candidate = uniqueIds.get(key);
            if (candidate) results.set(key, candidate);
        }
    }
    return results;
}

export function collectionRefIdentity(ref: XtreamCollectionRef) {
    const identity =
        typeof ref === 'number'
            ? null
            : normalizeContentMetadataPatch(ref.identity);
    return identity &&
        (identity.tmdbId !== undefined || identity.releaseYear !== undefined)
        ? { tmdb_id: identity.tmdbId, release_year: identity.releaseYear }
        : undefined;
}

type CollectionIdentity = Pick<XtreamContentItem, 'tmdb_id' | 'release_year'>;

/** Catalog evidence must confirm every saved identity field before replacing metadata. */
export function collectionSnapshotMatchesContent(
    saved: CollectionIdentity,
    current: CollectionIdentity | undefined,
    allowMissing = false
): boolean {
    const known = normalizeCollectionIdentity(saved);
    const actual = normalizeCollectionIdentity(current);
    return (['tmdb_id', 'release_year'] as const).every(
        (key) =>
            known[key] == null ||
            known[key] === actual[key] ||
            (allowMissing && actual[key] == null)
    );
}

/** Match Electron's metadata boundary, including numeric strings and unknown placeholders. */
export function normalizeCollectionIdentity(
    item: CollectionIdentity | undefined
) {
    const identity = normalizeContentMetadataPatch({
        tmdbId: item?.tmdb_id ?? undefined,
        releaseYear: item?.release_year ?? undefined,
    });
    return { tmdb_id: identity?.tmdbId, release_year: identity?.releaseYear };
}

/** Keep the durable snapshot separate until the actual catalog row confirms it. */
export function mergeCollectionItem(
    saved: XtreamContentItem | undefined,
    current: XtreamContentItem
): XtreamContentItem {
    if (!saved) return current;
    if (!collectionSnapshotMatchesContent(saved, current, true)) {
        return { ...saved, catalog_status: 'missing' };
    }
    if (!collectionSnapshotMatchesContent(saved, current))
        return {
            ...saved,
            // Routing is current catalog evidence, not saved presentation/identity.
            category_id: current.category_id || saved.category_id,
        };
    return {
        ...saved,
        ...current,
        catalog_status: 'present',
        title: current.title || saved.title,
        poster_url: current.poster_url || saved.poster_url,
        backdrop_url: current.backdrop_url || saved.backdrop_url,
        tmdb_id:
            normalizeCollectionIdentity(current).tmdb_id ??
            normalizeCollectionIdentity(saved).tmdb_id,
        release_year:
            normalizeCollectionIdentity(current).release_year ??
            normalizeCollectionIdentity(saved).release_year,
        original_title: current.original_title || saved.original_title,
        // Provider metadata never owns the user's favorite date/order.
        added_at: saved.added_at ?? current.added_at,
        position: saved.position ?? current.position,
    };
}

export function deduplicateRecentItems(
    items: StoredRecentItem[],
    keyForItem: (item: StoredRecentItem) => CollectionKey = (item) => item.id
): StoredRecentItem[] {
    const unique = new Map<CollectionKey, StoredRecentItem>();
    for (const item of items) {
        const key = keyForItem(item);
        const previous = unique.get(key);
        if (
            !previous ||
            Date.parse(item.viewedAt) > Date.parse(previous.viewedAt)
        )
            unique.set(key, item);
    }
    return [...unique.values()];
}
