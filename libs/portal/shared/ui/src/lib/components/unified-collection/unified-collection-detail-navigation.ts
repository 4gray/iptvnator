import {
    buildGlobalCollectionDetailNavigationTarget,
    getUnifiedCollectionNavigation,
    SeriesResumeTarget,
    STALKER_RETURN_TO_STATE_KEY,
    UnifiedCollectionItem,
    WorkspaceNavigationTarget,
} from '@iptvnator/portal/shared/util';

/**
 * Whether the route on screen may host this item's detail inline. A portal's
 * own favorites/recent tabs render only their own provider's items, while the
 * global collections host both portal providers; anything else falls back to
 * the portal type the page was configured with.
 */
export function canRenderCollectionDetailOnRoute(
    routerUrl: string,
    portalType: string | undefined,
    item: UnifiedCollectionItem
): boolean {
    if (routerUrl.includes('/workspace/xtreams/')) {
        return item.sourceType === 'xtream';
    }

    if (routerUrl.includes('/workspace/stalker/')) {
        return item.sourceType === 'stalker';
    }

    if (
        routerUrl.includes('/workspace/global-favorites') ||
        routerUrl.includes('/workspace/global-recent')
    ) {
        return item.sourceType === 'xtream' || item.sourceType === 'stalker';
    }

    return !portalType || portalType === item.sourceType;
}

/**
 * Route to the item's detail inside the matching global collection. Live
 * channels and M3U items have no such detail, so they keep the ordinary
 * in-portal navigation below.
 */
export function buildCollectionDetailNavigation(
    mode: 'favorites' | 'recent',
    item: UnifiedCollectionItem,
    seriesResume?: SeriesResumeTarget | null
): WorkspaceNavigationTarget | null {
    if (
        item.contentType === 'live' ||
        (item.sourceType !== 'xtream' && item.sourceType !== 'stalker')
    ) {
        return null;
    }

    return buildGlobalCollectionDetailNavigationTarget(
        mode,
        item,
        seriesResume
    );
}

/**
 * Ordinary navigation into the item's own portal. A Stalker detail carries
 * the current URL so its back affordance returns to this collection instead
 * of the portal's catalog root.
 */
export function buildCollectionPortalNavigation(
    item: UnifiedCollectionItem,
    routerUrl: string
): WorkspaceNavigationTarget | null {
    const navigation = getUnifiedCollectionNavigation(item);
    if (!navigation) {
        return null;
    }

    if (item.sourceType !== 'stalker' || item.contentType === 'live') {
        return navigation;
    }

    return {
        ...navigation,
        state: {
            ...(navigation.state ?? {}),
            [STALKER_RETURN_TO_STATE_KEY]: routerUrl,
        },
    };
}
