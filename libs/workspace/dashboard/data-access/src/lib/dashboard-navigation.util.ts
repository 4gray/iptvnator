import {
    PlaylistMeta,
    PortalActivityType,
    PortalAddedItem,
    PortalFavoriteItem,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import {
    buildStalkerDetailNavigationTarget,
    buildStalkerStateItem,
    buildXtreamNavigationTarget,
    getGlobalFavoriteNavigation,
    getRecentItemNavigation,
    WorkspaceNavigationTarget,
} from '@iptvnator/portal/shared/util';

/**
 * Pure navigation/link helpers for dashboard items.
 *
 * Extracted from `DashboardDataService` so the routing logic can be unit-tested
 * in isolation and the service stays a thin facade. None of these functions
 * touch component/service state — they map a dashboard item to a router link
 * (and optional navigation state) using the shared portal navigation builders.
 */

export type DashboardContentKind = 'all' | 'channels' | 'vod' | 'series';

export function isTypeInKind(
    type: PortalActivityType,
    kind: DashboardContentKind
): boolean {
    if (kind === 'all') {
        return true;
    }
    if (kind === 'channels') {
        return type === 'live';
    }
    if (kind === 'vod') {
        return type === 'movie';
    }
    return type === 'series';
}

export function getPlaylistLink(playlist: PlaylistMeta): string[] {
    if (playlist.serverUrl) {
        return ['/workspace', 'xtreams', playlist._id, 'vod'];
    }

    if (playlist.macAddress) {
        return ['/workspace', 'stalker', playlist._id, 'vod'];
    }

    return ['/workspace', 'playlists', playlist._id];
}

export function getRecentItemLink(item: PortalRecentItem): string[] {
    return getRecentItemNavigation(item).link;
}

export function getRecentItemNavigationState(
    item: PortalRecentItem
): WorkspaceNavigationTarget['state'] {
    return getRecentItemNavigation(item).state;
}

export function getGlobalFavoriteLink(item: PortalFavoriteItem): string[] {
    return getGlobalFavoriteNavigation(item).link;
}

export function getGlobalFavoriteNavigationState(
    item: PortalFavoriteItem
): WorkspaceNavigationTarget['state'] {
    return getGlobalFavoriteNavigation(item).state;
}

export function getRecentlyAddedLink(item: PortalAddedItem): string[] {
    if (item.source === 'stalker' && item.type !== 'live') {
        return buildStalkerDetailNavigationTarget({
            playlistId: item.playlist_id,
            type: item.type,
            categoryId: item.category_id,
            item: buildStalkerStateItem(item.stalker_item, {
                id: item.id,
                title: item.title,
                type: item.type,
                category_id: item.category_id,
                poster_url: item.poster_url,
            }),
        }).link;
    }

    return buildXtreamNavigationTarget({
        playlistId: item.playlist_id,
        type: item.type,
        categoryId: item.category_id,
        itemId: item.xtream_id,
        title: item.title,
        imageUrl: item.poster_url,
    }).link;
}

export function getRecentlyAddedNavigationState(
    item: PortalAddedItem
): WorkspaceNavigationTarget['state'] {
    if (item.source === 'stalker' && item.type !== 'live') {
        return buildStalkerDetailNavigationTarget({
            playlistId: item.playlist_id,
            type: item.type,
            categoryId: item.category_id,
            item: buildStalkerStateItem(item.stalker_item, {
                id: item.id,
                title: item.title,
                type: item.type,
                category_id: item.category_id,
                poster_url: item.poster_url,
            }),
        }).state;
    }

    return buildXtreamNavigationTarget({
        playlistId: item.playlist_id,
        type: item.type,
        categoryId: item.category_id,
        itemId: item.xtream_id,
        title: item.title,
        imageUrl: item.poster_url,
    }).state;
}
