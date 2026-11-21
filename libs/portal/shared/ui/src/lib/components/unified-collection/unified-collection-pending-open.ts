import { Router } from '@angular/router';
import {
    matchesOpenLiveCollectionItem,
    OpenLiveCollectionItemState,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { buildCollectionPortalNavigation } from './unified-collection-detail-navigation';

export interface PendingNonLiveOpen {
    readonly item: UnifiedCollectionItem;
    /** False when the row has no stream URL to hand to the player. */
    readonly navigated: boolean;
}

/**
 * The M3U film or episode a dashboard "open this item" handoff points at.
 *
 * The dashboard only knows a URL and a title, so it sends every M3U item as
 * a live target; the collection is the one place that knows the row's real
 * kind. A live row matching the same target wins, so the live tab keeps its
 * own auto-open untouched.
 */
export function findPendingNonLiveOpen(
    items: readonly UnifiedCollectionItem[],
    target: OpenLiveCollectionItemState | null
): UnifiedCollectionItem | null {
    if (target?.sourceType !== 'm3u') {
        return null;
    }

    // The shared matcher is live-only; asking it about a live-typed copy
    // reuses its identity rules without growing the startup bundle.
    const matches = items.filter((item) =>
        matchesOpenLiveCollectionItem({ ...item, contentType: 'live' }, target)
    );
    if (matches.some((item) => item.contentType === 'live')) {
        return null;
    }

    // The matcher also accepts a bare title; the exact stream wins over it.
    return (
        matches.find((item) => item.streamUrl?.trim() === target.itemId) ??
        matches[0] ??
        null
    );
}

/**
 * Opens that film or episode the way a grid click does. The collection
 * route is replaced, so Back returns to the dashboard instead of bouncing
 * through a page the user never asked for.
 */
export function openPendingNonLiveItem(
    items: readonly UnifiedCollectionItem[],
    target: OpenLiveCollectionItemState | null,
    router: Pick<Router, 'navigate' | 'url'>
): PendingNonLiveOpen | null {
    const item = findPendingNonLiveOpen(items, target);
    if (!item) {
        return null;
    }

    const navigation = buildCollectionPortalNavigation(item, router.url);
    if (!navigation) {
        return { item, navigated: false };
    }

    void router.navigate(navigation.link, {
        state: navigation.state,
        replaceUrl: true,
    });
    return { item, navigated: true };
}
