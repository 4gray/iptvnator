import { UnifiedCollectionItem } from '../collection/unified-collection-item.interface';
import {
    buildStalkerDetailNavigationTarget,
    buildStalkerStateItem,
    buildXtreamNavigationTarget,
    WorkspaceNavigationTarget,
} from './workspace-portal-navigation';
import {
    isStalkerSeriesFlag,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';

/**
 * Marks a Stalker handoff whose origin is exactly one history entry back, so
 * the portal detail's back affordance can step through history instead of
 * re-navigating to `stalkerReturnTo`.
 *
 * The collection page keeps its active tab, scope and open inline detail only
 * in `window.history.state` (`collectionViewState` / `openCollectionDetailItem`).
 * `navigateByUrl()` starts a fresh entry without them, so the collection would
 * come back on its default `live` tab and leave the portal page one browser
 * Back away. Only this builder sets the flag, and only when it also supplies
 * `returnTo`, so every other `stalkerReturnTo` caller keeps re-navigating.
 */
export const STALKER_RETURN_BY_HISTORY_STATE_KEY = 'stalkerReturnByHistory';

/**
 * Reads the flag above off a history/navigation state record.
 */
export function getStalkerReturnByHistoryState(state: unknown): boolean {
    if (!state || typeof state !== 'object') {
        return false;
    }

    return (
        (state as Record<string, unknown>)[
            STALKER_RETURN_BY_HISTORY_STATE_KEY
        ] === true
    );
}

/**
 * Builds the portal-detail target for a collection item, or `null` when no
 * exact detail route can be formed. Unlike `getUnifiedCollectionNavigation`
 * this never degrades to a category- or section-only route: the caller shows
 * a "View in portal" affordance only when the jump lands on the item itself.
 */
export function getUnifiedCollectionDetailNavigation(
    item: UnifiedCollectionItem,
    options?: { returnTo?: string | null }
): WorkspaceNavigationTarget | null {
    if (item.contentType === 'live') {
        return null;
    }

    if (item.sourceType === 'xtream') {
        const categoryId = toTrimmedSegment(item.categoryId);
        const itemId =
            toPositiveIntegerSegment(item.xtreamId) ??
            toPositiveIntegerSegment(lastUidSegment(item.uid));
        if (!categoryId || !itemId) {
            return null;
        }

        return buildXtreamNavigationTarget({
            playlistId: item.playlistId,
            type: item.contentType,
            categoryId,
            itemId,
            title: item.name,
            imageUrl: item.posterUrl ?? item.logo ?? null,
        });
    }

    if (item.sourceType === 'stalker') {
        const stalkerItem = item.stalkerItem as StalkerPortalItem | undefined;
        const type = resolveStalkerDetailType(item, stalkerItem);
        const categoryId = resolveStalkerDetailCategoryId(
            item,
            stalkerItem,
            type
        );

        const returnTo = options?.returnTo ?? null;
        const target = buildStalkerDetailNavigationTarget({
            playlistId: item.playlistId,
            type,
            categoryId,
            item: buildStalkerStateItem(stalkerItem, {
                id: item.stalkerId ?? lastUidSegment(item.uid) ?? '',
                title: item.name,
                type,
                category_id: categoryId,
                poster_url: item.posterUrl ?? item.logo ?? undefined,
            }),
            returnTo,
        });

        return returnTo
            ? {
                  ...target,
                  state: {
                      ...(target.state ?? {}),
                      [STALKER_RETURN_BY_HISTORY_STATE_KEY]: true,
                  },
              }
            : target;
    }

    return null;
}

/**
 * Mirrors `resolveStalkerCollectionDetailMode()` in
 * `libs/portal/stalker/feature/src/lib/stalker-collection-detail-mode.ts`:
 * only a regular `/series` item belongs in the series catalog. Embedded `series[]`
 * snapshots and lazy Ministra VOD `is_series` items normalize to `series` in
 * `extractStalkerItemType()` but must stay in the VOD catalog — the lazy
 * season/episode fetch in `StalkerCatalogFacadeService.selectItem()` is gated
 * on the VOD content type, so routing them to `/series` would leave the detail
 * unable to load its episodes.
 */
function resolveStalkerDetailType(
    item: UnifiedCollectionItem,
    stalkerItem: StalkerPortalItem | undefined
): 'movie' | 'series' {
    const embeddedSeries = (stalkerItem as { series?: unknown[] } | undefined)
        ?.series;
    const hasEmbeddedSeries =
        Array.isArray(embeddedSeries) && embeddedSeries.length > 0;
    const isVodSeries = isStalkerSeriesFlag(
        (stalkerItem as { is_series?: unknown } | undefined)?.is_series
    );

    return item.contentType === 'series' && !hasEmbeddedSeries && !isVodSeries
        ? 'series'
        : 'movie';
}

/**
 * Mirrors `resolveStalkerCollectionSelectedCategory()` in
 * `libs/portal/stalker/feature/src/lib/stalker-collection-detail-mode.ts`: a
 * VOD-catalog item persisted from the series view carries the virtual
 * `series` category, which would otherwise form a `/vod/series` route.
 */
function resolveStalkerDetailCategoryId(
    item: UnifiedCollectionItem,
    stalkerItem: StalkerPortalItem | undefined,
    type: 'movie' | 'series'
): string | number | undefined {
    const categoryId =
        item.categoryId ??
        (stalkerItem as { category_id?: string | number } | undefined)
            ?.category_id;

    if (
        type === 'movie' &&
        String(categoryId ?? '').toLowerCase() === 'series'
    ) {
        return 'vod';
    }

    return categoryId;
}

function toTrimmedSegment(value: unknown): string {
    return String(value ?? '').trim();
}

function toPositiveIntegerSegment(value: unknown): string | null {
    const parsed = Number(toTrimmedSegment(value));
    return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function lastUidSegment(uid: string): string | undefined {
    const segments = uid.split('::');
    return segments.length > 0 ? segments[segments.length - 1] : undefined;
}
