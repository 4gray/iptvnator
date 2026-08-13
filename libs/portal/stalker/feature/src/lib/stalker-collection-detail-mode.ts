import {
    buildStalkerStateItem,
    toStalkerCategoryId,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { isStalkerSeriesFlag } from '@iptvnator/portal/stalker/data-access';
import { StalkerPortalItem } from '@iptvnator/shared/interfaces';

/** Catalog section a collection item is rendered as. */
export type StalkerDetailCategory = 'vod' | 'series';

export interface StalkerCollectionDetailMode {
    category: StalkerDetailCategory;
    selectedContentType: StalkerDetailCategory;
    hasEmbeddedSeries: boolean;
    needsSeriesFetch: boolean;
}

/**
 * Rebuilds the portal row a collection entry points at. A favorite/recent
 * snapshot may be sparse, so the unified item fills in whatever it can.
 */
export function resolveStalkerCollectionItem(
    item: UnifiedCollectionItem
): StalkerPortalItem {
    const uidParts = item.uid.split('::');

    return buildStalkerStateItem(
        item.stalkerItem as StalkerPortalItem | undefined,
        {
            id: item.stalkerId ?? uidParts[uidParts.length - 1] ?? item.uid,
            title: item.name,
            type: item.contentType,
            category_id: item.categoryId,
            poster_url: item.posterUrl ?? item.logo ?? undefined,
        }
    ) as StalkerPortalItem;
}

/**
 * Picks the detail flow a collection item belongs to. Embedded `series[]`
 * snapshots and lazy Ministra VOD `is_series` rows report as series but live
 * in the VOD catalog, so only a portal `/series` row is a regular series.
 *
 * `getUnifiedCollectionDetailNavigation()` in `@iptvnator/portal/shared/util`
 * mirrors this rule — keep the two in sync.
 */
export function resolveStalkerCollectionDetailMode(
    item: UnifiedCollectionItem,
    stalkerItem: StalkerPortalItem
): StalkerCollectionDetailMode {
    const series = (stalkerItem as { series?: unknown[] }).series;
    const hasEmbeddedSeries = Array.isArray(series) && series.length > 0;
    const isVodSeries = isStalkerSeriesFlag(
        (stalkerItem as { is_series?: unknown }).is_series
    );
    const isRegularSeries =
        item.contentType === 'series' && !hasEmbeddedSeries && !isVodSeries;
    const selectedContentType: StalkerDetailCategory = isRegularSeries
        ? 'series'
        : 'vod';

    return {
        category: selectedContentType,
        selectedContentType,
        hasEmbeddedSeries,
        needsSeriesFetch:
            selectedContentType === 'vod' && !hasEmbeddedSeries && isVodSeries,
    };
}

/**
 * Normalizes the virtual `series` category to `vod` for items that render as
 * VOD, so the lazy season/episode fetch gated on the VOD content type can run.
 */
export function resolveStalkerCollectionSelectedCategory(
    item: UnifiedCollectionItem,
    stalkerItem: StalkerPortalItem,
    detailMode: StalkerCollectionDetailMode
): string | number {
    const categoryId =
        item.categoryId ??
        (stalkerItem as { category_id?: string | number }).category_id;

    if (
        detailMode.selectedContentType === 'vod' &&
        String(categoryId ?? '').toLowerCase() === 'series'
    ) {
        return 'vod';
    }

    return categoryId ?? toStalkerCategoryId(detailMode.selectedContentType);
}
