import {
    PortalActivityType,
    PortalFavoriteItem,
    PortalRecentItem,
    StalkerPortalItem,
} from 'shared-interfaces';

/** Internal target produced by navigation helpers. */
export interface DashboardNavigationTarget {
    link: string[];
    state?: Record<string, unknown>;
}

// ────── Recent-item navigation ──────

export function getRecentItemNavigation(
    item: PortalRecentItem
): DashboardNavigationTarget {
    if (item.source === 'stalker') {
        return {
            link: ['/workspace', 'stalker', item.playlist_id, 'recent'],
            state: {
                openRecentItem: buildStalkerStateItem(item.stalker_item, item),
            },
        };
    }

    if (item.source === 'm3u') {
        return {
            link: ['/workspace', 'playlists', item.playlist_id, 'recent'],
            state: {
                openRecentChannelUrl: String(item.xtream_id ?? item.id ?? ''),
            },
        };
    }

    return buildXtreamNavigationTarget({
        playlistId: item.playlist_id,
        type: item.type,
        categoryId: item.category_id,
        itemId: item.xtream_id,
        title: item.title,
        imageUrl: item.poster_url,
    });
}

// ────── Favorite-item navigation ──────

export function getGlobalFavoriteNavigation(
    item: PortalFavoriteItem
): DashboardNavigationTarget {
    if (item.source === 'stalker') {
        return {
            link: ['/workspace', 'stalker', item.playlist_id, 'favorites'],
            state: {
                openFavoriteItem: buildStalkerStateItem(
                    item.stalker_item,
                    item
                ),
            },
        };
    }

    if (item.source === 'm3u') {
        return {
            link: ['/workspace', 'playlists', item.playlist_id, 'favorites'],
        };
    }

    return buildXtreamNavigationTarget({
        playlistId: item.playlist_id,
        type: item.type,
        categoryId: item.category_id,
        itemId: item.xtream_id,
        title: item.title,
        imageUrl: item.poster_url,
    });
}

// ────── Xtream link builders ──────

export function buildXtreamNavigationTarget(params: {
    playlistId: string;
    type: PortalActivityType;
    categoryId: string | number;
    itemId: string | number;
    title?: string;
    imageUrl?: string;
}): DashboardNavigationTarget {
    const link = buildXtreamItemLink(params);
    const routeType = toXtreamRouteType(params.type);
    if (routeType !== 'live') {
        return { link };
    }

    const streamId = Number(toPathSegment(params.itemId));
    if (!Number.isFinite(streamId) || streamId <= 0) {
        return { link };
    }

    return {
        link,
        state: {
            openXtreamLiveItemId: streamId,
            openXtreamLiveTitle: params.title || '',
            openXtreamLivePoster: params.imageUrl || '',
        },
    };
}

export function buildXtreamItemLink(params: {
    playlistId: string;
    type: PortalActivityType;
    categoryId: string | number;
    itemId: string | number;
}): string[] {
    const routeType = toXtreamRouteType(params.type);
    const categoryId = toPathSegment(params.categoryId);
    const itemId = toPathSegment(params.itemId);

    if (routeType === 'live') {
        return categoryId
            ? ['/workspace', 'xtreams', params.playlistId, 'live', categoryId]
            : ['/workspace', 'xtreams', params.playlistId, 'live'];
    }

    if (categoryId && itemId) {
        return [
            '/workspace',
            'xtreams',
            params.playlistId,
            routeType,
            categoryId,
            itemId,
        ];
    }

    if (categoryId) {
        return [
            '/workspace',
            'xtreams',
            params.playlistId,
            routeType,
            categoryId,
        ];
    }

    return ['/workspace', 'xtreams', params.playlistId, routeType];
}

// ────── Stalker state helpers ──────

export function buildStalkerStateItem(
    rawItem: StalkerPortalItem | undefined,
    fallback: {
        id: string | number;
        title: string;
        type: PortalActivityType;
        poster_url?: string;
    }
): Record<string, unknown> {
    const normalizedCategory = toStalkerCategoryId(
        rawItem?.category_id ?? fallback.type
    );
    if (rawItem) {
        return {
            ...(rawItem as Record<string, unknown>),
            category_id: normalizedCategory,
        };
    }

    const title = fallback.title || '';
    return {
        id: String(fallback.id ?? ''),
        title,
        name: title,
        o_name: title,
        category_id: normalizedCategory,
        cover: fallback.poster_url || '',
        logo: fallback.poster_url || '',
    };
}

// ────── Small helpers ──────

export function toXtreamRouteType(
    type: PortalActivityType
): 'live' | 'vod' | 'series' {
    return type === 'movie' ? 'vod' : type;
}

export function toStalkerCategoryId(value: unknown): 'vod' | 'series' | 'itv' {
    const normalized = String(value ?? '').toLowerCase();
    if (normalized === 'series') return 'series';
    if (normalized === 'itv' || normalized === 'live') return 'itv';
    return 'vod';
}

function toPathSegment(value: string | number): string {
    return String(value ?? '').trim();
}
