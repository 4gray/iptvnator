import {
    TypedXtreamCollectionRef,
    XTREAM_CONTENT_TYPES,
    XtreamContentItem,
} from './xtream-data-source.interface';

export type CollectionKey = number | string;
export interface StoredRecentItem {
    readonly id: CollectionKey;
    readonly viewedAt: string;
    readonly backdropUrl?: string;
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
    for (const item of [...Object.values(snapshots), ...cached]) {
        if (!item || !wantedIds.has(item.xtream_id)) continue;
        const key = itemCollectionKey(item);
        if (key !== null) typedItems.set(key, item);
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

export function deduplicateRecentItems(
    items: StoredRecentItem[]
): StoredRecentItem[] {
    const unique = new Map<CollectionKey, StoredRecentItem>();
    for (const item of items) {
        const previous = unique.get(item.id);
        if (
            !previous ||
            Date.parse(item.viewedAt) > Date.parse(previous.viewedAt)
        )
            unique.set(item.id, item);
    }
    return [...unique.values()];
}
