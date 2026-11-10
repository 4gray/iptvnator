import { isCatalogUnavailable } from '@iptvnator/shared/interfaces';
import type { FavoriteItem } from '@iptvnator/portal/xtream/data-access';
import type { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';

export function xtreamGuideFavoriteRows(
    items: readonly FavoriteItem[],
    sqlite: boolean
): ReadonlyMap<number, number> {
    const rows = new Map<number, number>();
    for (const item of items) {
        if (
            item.type === 'live' &&
            item.content_id != null &&
            !isCatalogUnavailable({ catalogStatus: item.catalog_status })
        ) {
            rows.set(
                item.xtream_id,
                sqlite ? item.content_id : item.category_id
            );
        }
    }
    return rows;
}

/** Native collection reads may resolve a stream to its hidden category copy. */
export async function resolveVisibleXtreamFavoriteCopies(
    favorites: ReadonlyMap<number, number>,
    rows: readonly XtreamLiveChannelItem[],
    isFavorite: (id: number) => Promise<boolean>,
    signal: AbortSignal
): Promise<ReadonlyMap<number, number>> {
    if (!favorites.size) return favorites;
    const visibleIds = new Set(rows.map((row) => Number(row.id)));
    let resolved: Map<number, number> | undefined;
    for (const row of rows) {
        if (signal.aborted) return favorites;
        const savedId = (resolved ?? favorites).get(row.xtream_id);
        if (savedId === undefined || visibleIds.has(savedId)) continue;
        const id = Number(row.id);
        if (
            Number.isSafeInteger(id) &&
            (await isFavorite(id).catch(() => false))
        ) {
            resolved ??= new Map(favorites);
            resolved.set(row.xtream_id, id);
        }
    }
    return resolved ?? favorites;
}
