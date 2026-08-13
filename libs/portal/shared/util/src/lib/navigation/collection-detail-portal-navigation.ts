import { UnifiedCollectionItem } from '../collection/unified-collection-item.interface';
import {
    buildStalkerDetailNavigationTarget,
    buildStalkerStateItem,
    buildXtreamNavigationTarget,
    clearNavigationStateKeys,
    getStalkerReturnToState,
    STALKER_RETURN_TO_STATE_KEY,
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
 * Back away. Only this builder sets the marker, and only when it also supplies
 * `returnTo`, so every other `stalkerReturnTo` caller keeps re-navigating.
 *
 * The value is the handed-off item's identity rather than a bare `true`:
 * `openStalkerItem` is consumed on arrival, but the return keys stay on the
 * history entry, and a Stalker detail opens in place without pushing one. So
 * after a Back + browser Forward the same entry can host a *different* title,
 * and an unbound marker would send that title's back affordance out to the
 * collection instead of closing it. Binding scopes the whole return contract
 * to the one title the handoff opened.
 */
export const STALKER_RETURN_BY_HISTORY_STATE_KEY = 'stalkerReturnByHistory';

/**
 * Reads the marker above off a history/navigation state record, returning the
 * item identity it is bound to, or `null` when absent/malformed.
 */
export function getStalkerReturnByHistoryState(state: unknown): string | null {
    if (!state || typeof state !== 'object') {
        return null;
    }

    const raw = (state as Record<string, unknown>)[
        STALKER_RETURN_BY_HISTORY_STATE_KEY
    ];

    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * Normalizes a Stalker item id for marker comparison. Mirrors the catalog
 * view's own `stalkerItemIdentity()`: a lazy episode id carries a `parent:child`
 * suffix, and only the parent identifies the opened title.
 */
export function normalizeStalkerHandoffIdentity(value: unknown): string {
    return (
        String(value ?? '')
            .trim()
            .split(':')[0]
            ?.trim() ?? ''
    );
}

/**
 * Identity of a Stalker item for marker comparison, restricted to the fields
 * that survive `buildStalkerSelectedVodItem()` — it derives `id` from
 * `id ?? stream_id` and drops `series_id`/`movie_id`. Comparing against the
 * wider `extractStalkerItemId()` set would read an identity the opened detail
 * can no longer produce, so the marker would never match and the back
 * affordance would silently do nothing.
 */
export function stalkerHandoffIdentityOf(item: unknown): string {
    const raw = (item ?? {}) as Record<string, unknown>;

    return normalizeStalkerHandoffIdentity(raw['id'] ?? raw['stream_id']);
}

/**
 * True when the history entry's return marker belongs to the currently opened
 * item. A marker left over from an earlier handoff on the same entry is stale
 * and must not drive the back affordance.
 */
export function isStalkerReturnByHistoryFor(
    state: unknown,
    selectedItem: unknown
): boolean {
    const marker = getStalkerReturnByHistoryState(state);
    const identity = stalkerHandoffIdentityOf(selectedItem);

    return Boolean(marker && identity && marker === identity);
}

/**
 * Retires the return contract from the current history entry. The handoff is
 * one-shot: without this, browser Forward reopens the portal entry with the
 * marker intact, and reopening the same title from the catalog would send its
 * back affordance out to the collection instead of just closing it.
 */
export function consumeStalkerReturnMarker(): void {
    clearNavigationStateKeys([
        STALKER_RETURN_BY_HISTORY_STATE_KEY,
        STALKER_RETURN_TO_STATE_KEY,
    ]);
}

/**
 * What a Stalker detail's back affordance should do, given the current history
 * entry and the title it currently shows. Both back handlers share this so the
 * marker/`returnTo` precedence cannot drift between them.
 */
export type StalkerBackNavigation =
    | { kind: 'history-back' }
    | { kind: 'navigate'; url: string }
    | { kind: 'none' };

export function resolveStalkerBackNavigation(
    state: unknown,
    selectedItem: unknown
): StalkerBackNavigation {
    // A collection handoff is exactly one entry back, and the collection's
    // tab/scope/inline-detail live only on that entry — re-navigating would
    // drop them and leave the portal page one browser Back away. The keys
    // outlive the handoff though, so a marker bound to another title is stale
    // and must suppress the whole contract: back then just closes the detail.
    if (getStalkerReturnByHistoryState(state)) {
        return isStalkerReturnByHistoryFor(state, selectedItem)
            ? { kind: 'history-back' }
            : { kind: 'none' };
    }

    const returnTo = getStalkerReturnToState(state);
    return returnTo ? { kind: 'navigate', url: returnTo } : { kind: 'none' };
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
        const stalkerId = item.stalkerId ?? lastUidSegment(item.uid) ?? '';
        const target = buildStalkerDetailNavigationTarget({
            playlistId: item.playlistId,
            type,
            categoryId,
            item: buildStalkerStateItem(stalkerItem, {
                id: stalkerId,
                title: item.name,
                type,
                category_id: categoryId,
                poster_url: item.posterUrl ?? item.logo ?? undefined,
            }),
            returnTo,
        });

        // Bind the marker to the identity the opened detail will actually
        // report. A row identified only by `movie_id`/`series_id` normalizes
        // to an empty id, so no marker is set and the handoff simply falls
        // back to re-navigating via `stalkerReturnTo`.
        const handoffIdentity = stalkerItem
            ? stalkerHandoffIdentityOf(stalkerItem)
            : normalizeStalkerHandoffIdentity(stalkerId);

        return returnTo && handoffIdentity
            ? {
                  ...target,
                  state: {
                      ...(target.state ?? {}),
                      [STALKER_RETURN_BY_HISTORY_STATE_KEY]: handoffIdentity,
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
