import {
    PortalActivityType,
    PortalFavoriteItem,
    PortalRecentItem,
    StalkerPortalItem,
} from 'shared-interfaces';
import { UnifiedCollectionItem } from '../collection/unified-collection-item.interface';

export interface WorkspaceNavigationTarget {
    link: string[];
    state?: Record<string, unknown>;
}

export function getRecentItemNavigation(
    item: PortalRecentItem
): WorkspaceNavigationTarget {
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

export function getGlobalFavoriteNavigation(
    item: PortalFavoriteItem
): WorkspaceNavigationTarget {
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

export function buildXtreamNavigationTarget(params: {
    playlistId: string;
    type: PortalActivityType;
    categoryId?: string | number | null;
    itemId?: string | number | null;
    title?: string;
    imageUrl?: string | null;
}): WorkspaceNavigationTarget {
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
    categoryId?: string | number | null;
    itemId?: string | number | null;
}): string[] {
    const routeType = toXtreamRouteType(params.type);
    const categoryId = toPathSegment(params.categoryId);
    const itemId = toPathSegment(params.itemId);

    if (routeType === 'live') {
        return ['/workspace', 'xtreams', params.playlistId, 'live'];
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

export function getUnifiedCollectionNavigation(
    item: UnifiedCollectionItem
): WorkspaceNavigationTarget | null {
    if (item.sourceType === 'xtream') {
        return buildXtreamNavigationTarget({
            playlistId: item.playlistId,
            type: item.contentType,
            categoryId: item.categoryId,
            itemId: item.xtreamId,
            title: item.name,
            imageUrl: item.posterUrl ?? item.logo ?? null,
        });
    }

    if (item.sourceType === 'stalker') {
        const section = item.contentType === 'movie' ? 'vod' : item.contentType;
        const categoryId = toPathSegment(item.categoryId);
        const link = categoryId
            ? ['/workspace', 'stalker', item.playlistId, section, categoryId]
            : ['/workspace', 'stalker', item.playlistId, section];

        return { link };
    }

    return null;
}

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

function toPathSegment(value: unknown): string {
    return String(value ?? '').trim();
}
