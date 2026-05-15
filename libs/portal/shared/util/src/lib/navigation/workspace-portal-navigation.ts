import {
    extractStalkerItemId,
    PortalActivityType,
    PortalFavoriteItem,
    PortalRecentItem,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import {
    buildCollectionUid,
    buildXtreamCollectionUid,
    CollectionContentType,
    CollectionSourceType,
    UnifiedCollectionItem,
} from '../collection/unified-collection-item.interface';
import { CollectionScope } from '../collection/scope-toggle.service';

export interface WorkspaceNavigationTarget {
    link: string[];
    state?: Record<string, unknown>;
}

export const OPEN_LIVE_COLLECTION_ITEM_STATE_KEY = 'openLiveCollectionItem';
export const OPEN_COLLECTION_DETAIL_STATE_KEY = 'openCollectionDetailItem';
export const OPEN_STALKER_ITEM_STATE_KEY = 'openStalkerItem';
export const STALKER_RETURN_TO_STATE_KEY = 'stalkerReturnTo';
export const COLLECTION_VIEW_STATE_KEY = 'collectionViewState';

export interface OpenLiveCollectionItemState {
    contentType: 'live';
    sourceType: CollectionSourceType;
    playlistId: string;
    itemId: string;
    title?: string;
    imageUrl?: string | null;
}

export interface OpenCollectionDetailItemState {
    item: UnifiedCollectionItem;
}

export interface CollectionViewState {
    selectedContentType?: CollectionContentType;
    scope?: CollectionScope;
}

export function getRecentItemNavigation(
    item: PortalRecentItem
): WorkspaceNavigationTarget {
    if (item.type === 'live') {
        return buildLiveCollectionNavigationTarget({
            mode: 'recent',
            sourceType: item.source,
            playlistId: item.playlist_id,
            itemId: item.xtream_id ?? item.id,
            title: item.title,
            imageUrl: item.poster_url,
        });
    }

    const collectionItem = buildDashboardCollectionDetailItem(item);
    if (collectionItem) {
        return buildGlobalCollectionDetailNavigationTarget(
            'recent',
            collectionItem
        );
    }

    if (item.source === 'stalker') {
        return buildStalkerDetailNavigationTarget({
            playlistId: item.playlist_id,
            type: item.type,
            categoryId: item.category_id,
            item: buildStalkerStateItem(item.stalker_item, item),
            returnTo: '/workspace/dashboard',
        });
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
    if (item.type === 'live') {
        return buildLiveCollectionNavigationTarget({
            mode: 'favorites',
            sourceType: item.source,
            playlistId: item.playlist_id,
            itemId: item.xtream_id ?? item.id,
            title: item.title,
            imageUrl: item.poster_url,
        });
    }

    const collectionItem = buildDashboardCollectionDetailItem(item);
    if (collectionItem) {
        return buildGlobalCollectionDetailNavigationTarget(
            'favorites',
            collectionItem
        );
    }

    if (item.source === 'stalker') {
        return buildStalkerDetailNavigationTarget({
            playlistId: item.playlist_id,
            type: item.type,
            categoryId: item.category_id,
            item: buildStalkerStateItem(item.stalker_item, item),
            returnTo: '/workspace/dashboard',
        });
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

export function buildLiveCollectionNavigationTarget(params: {
    mode: 'favorites' | 'recent';
    sourceType: CollectionSourceType;
    playlistId: string;
    itemId?: string | number | null;
    title?: string;
    imageUrl?: string | null;
}): WorkspaceNavigationTarget {
    return {
        link: buildCollectionRoute(
            params.sourceType,
            params.playlistId,
            params.mode
        ),
        state: {
            [OPEN_LIVE_COLLECTION_ITEM_STATE_KEY]:
                buildOpenLiveCollectionItemState(params),
        },
    };
}

export function buildGlobalCollectionDetailNavigationTarget(
    mode: 'favorites' | 'recent',
    item: UnifiedCollectionItem
): WorkspaceNavigationTarget {
    return {
        link: [
            '/workspace',
            mode === 'favorites' ? 'global-favorites' : 'global-recent',
        ],
        state: {
            [OPEN_COLLECTION_DETAIL_STATE_KEY]:
                buildOpenCollectionDetailItemState(item),
        },
    };
}

export function buildCollectionViewState(params: {
    selectedContentType?: CollectionContentType | null;
    scope?: CollectionScope | null;
}): CollectionViewState | null {
    const selectedContentType = normalizeCollectionContentType(
        params.selectedContentType
    );
    const scope = normalizeCollectionScope(params.scope);

    if (!selectedContentType && !scope) {
        return null;
    }

    return {
        ...(selectedContentType ? { selectedContentType } : {}),
        ...(scope ? { scope } : {}),
    };
}

export function getCollectionViewState(
    state: unknown
): CollectionViewState | null {
    const record = toStateRecord(state);
    const candidate = toStateRecord(record?.[COLLECTION_VIEW_STATE_KEY]);

    return buildCollectionViewState({
        selectedContentType: candidate?.[
            'selectedContentType'
        ] as CollectionContentType | null,
        scope: candidate?.['scope'] as CollectionScope | null,
    });
}

export function buildOpenCollectionDetailItemState(
    item: UnifiedCollectionItem
): OpenCollectionDetailItemState {
    return {
        item: normalizeCollectionDetailItem(item),
    };
}

export function getOpenCollectionDetailItemState(
    state: unknown
): OpenCollectionDetailItemState | null {
    const record = toStateRecord(state);
    const candidate = toStateRecord(record?.[OPEN_COLLECTION_DETAIL_STATE_KEY]);
    const item = normalizeCollectionDetailItem(candidate?.['item']);

    return item ? { item } : null;
}

export function buildOpenLiveCollectionItemState(params: {
    sourceType: CollectionSourceType;
    playlistId: string;
    itemId?: string | number | null;
    title?: string;
    imageUrl?: string | null;
}): OpenLiveCollectionItemState {
    return {
        contentType: 'live',
        sourceType: params.sourceType,
        playlistId: params.playlistId,
        itemId: toPathSegment(params.itemId),
        title: params.title,
        imageUrl: params.imageUrl,
    };
}

export function getOpenLiveCollectionItemState(
    state: unknown
): OpenLiveCollectionItemState | null {
    const record = toStateRecord(state);
    const candidate = record?.[OPEN_LIVE_COLLECTION_ITEM_STATE_KEY];
    if (!candidate || typeof candidate !== 'object') {
        return null;
    }

    const sourceType = toPathSegment(
        (candidate as Record<string, unknown>)['sourceType']
    ) as CollectionSourceType;
    const playlistId = toPathSegment(
        (candidate as Record<string, unknown>)['playlistId']
    );
    const itemId = toPathSegment(
        (candidate as Record<string, unknown>)['itemId']
    );

    if (
        !playlistId ||
        !itemId ||
        (sourceType !== 'm3u' &&
            sourceType !== 'xtream' &&
            sourceType !== 'stalker')
    ) {
        return null;
    }

    return {
        contentType: 'live',
        sourceType,
        playlistId,
        itemId,
        title: toOptionalPathSegment(
            (candidate as Record<string, unknown>)['title']
        ),
        imageUrl: toOptionalPathSegment(
            (candidate as Record<string, unknown>)['imageUrl']
        ),
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
        if (item.contentType === 'live') {
            return buildLiveCollectionNavigationTarget({
                mode: 'favorites',
                sourceType: item.sourceType,
                playlistId: item.playlistId,
                itemId: item.stalkerId,
                title: item.name,
                imageUrl: item.logo ?? item.posterUrl ?? null,
            });
        }

        return buildStalkerDetailNavigationTarget({
            playlistId: item.playlistId,
            type: item.contentType,
            categoryId: item.categoryId,
            item: buildStalkerStateItem(
                item.stalkerItem as StalkerPortalItem | undefined,
                {
                    id: item.stalkerId ?? getLastSegment(item.uid, '::') ?? '',
                    title: item.name,
                    type: item.contentType,
                    category_id: item.categoryId,
                    poster_url: item.posterUrl ?? item.logo ?? undefined,
                }
            ),
        });
    }

    return null;
}

export function buildStalkerDetailNavigationTarget(params: {
    playlistId: string;
    type: Exclude<PortalActivityType, 'live'>;
    categoryId?: string | number | null;
    item: Record<string, unknown>;
    returnTo?: string | string[] | null;
}): WorkspaceNavigationTarget {
    const section = params.type === 'movie' ? 'vod' : 'series';
    const normalizedCategoryId = toPathSegment(
        params.categoryId ?? toStalkerCategoryId(params.type)
    );
    const link = normalizedCategoryId
        ? [
              '/workspace',
              'stalker',
              params.playlistId,
              section,
              normalizedCategoryId,
          ]
        : ['/workspace', 'stalker', params.playlistId, section];

    const state: Record<string, unknown> = {
        [OPEN_STALKER_ITEM_STATE_KEY]: params.item,
    };
    const returnTo = normalizeReturnToState(params.returnTo);
    if (returnTo) {
        state[STALKER_RETURN_TO_STATE_KEY] = returnTo;
    }

    return {
        link,
        state,
    };
}

export function getOpenStalkerItemState(
    state: unknown
): Record<string, unknown> | null {
    const record = toStateRecord(state);
    const candidate =
        record?.[OPEN_STALKER_ITEM_STATE_KEY] ??
        record?.['openFavoriteItem'] ??
        record?.['openRecentItem'];
    return candidate && typeof candidate === 'object'
        ? (candidate as Record<string, unknown>)
        : null;
}

export function getStalkerReturnToState(state: unknown): string | null {
    const record = toStateRecord(state);
    const candidate = record?.[STALKER_RETURN_TO_STATE_KEY];
    return typeof candidate === 'string' && candidate.trim().length > 0
        ? candidate.trim()
        : null;
}

export function clearNavigationStateKeys(keys: string[]): void {
    try {
        const state = toStateRecord(window.history.state);
        if (!state) {
            return;
        }

        const nextState = { ...state };
        let changed = false;
        keys.forEach((key) => {
            if (key in nextState) {
                delete nextState[key];
                changed = true;
            }
        });

        if (changed) {
            window.history.replaceState(nextState, document.title);
        }
    } catch {
        // no-op
    }
}

export function matchesOpenLiveCollectionItem(
    item: UnifiedCollectionItem,
    target: OpenLiveCollectionItemState
): boolean {
    if (
        item.contentType !== 'live' ||
        item.sourceType !== target.sourceType ||
        item.playlistId !== target.playlistId
    ) {
        return false;
    }

    const targetId = toPathSegment(target.itemId);
    const sourceItemId = getLastSegment(item.uid, '::') ?? '';
    const candidates = [
        sourceItemId,
        item.streamUrl,
        item.channelId,
        item.xtreamId,
        item.stalkerId,
        item.contentId,
    ]
        .map((value) => toPathSegment(value))
        .filter(Boolean);

    if (candidates.includes(targetId)) {
        return true;
    }

    const normalizedTargetTitle = target.title?.trim().toLowerCase();
    return Boolean(
        normalizedTargetTitle &&
        item.name.trim().toLowerCase() === normalizedTargetTitle
    );
}

function getLastSegment(value: string, separator: string): string | undefined {
    const segments = value.split(separator);
    return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

function normalizeReturnToState(
    value: string | string[] | null | undefined
): string | null {
    if (Array.isArray(value)) {
        const normalized = value.join('/');
        return normalized.trim() ? normalized : null;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }

    return null;
}

function normalizeCollectionContentType(
    value: CollectionContentType | null | undefined
): CollectionContentType | null {
    return value === 'live' || value === 'movie' || value === 'series'
        ? value
        : null;
}

function normalizeCollectionScope(
    value: CollectionScope | null | undefined
): CollectionScope | null {
    return value === 'playlist' || value === 'all' ? value : null;
}

function buildDashboardCollectionDetailItem(
    item: PortalFavoriteItem | PortalRecentItem
): UnifiedCollectionItem | null {
    if (
        item.type === 'live' ||
        (item.source !== 'xtream' && item.source !== 'stalker')
    ) {
        return null;
    }

    if (item.source === 'xtream') {
        return normalizeCollectionDetailItem({
            uid: buildXtreamCollectionUid(
                item.playlist_id,
                item.type,
                item.xtream_id
            ),
            name: item.title,
            contentType: item.type,
            sourceType: 'xtream',
            playlistId: item.playlist_id,
            playlistName: item.playlist_name ?? '',
            posterUrl: item.poster_url ?? null,
            xtreamId: toOptionalNumber(item.xtream_id),
            contentId: toOptionalNumber(item.id),
            categoryId: item.category_id,
            addedAt: 'added_at' in item ? item.added_at : undefined,
            viewedAt: 'viewed_at' in item ? item.viewed_at : undefined,
        });
    }

    const stalkerItem = buildStalkerStateItem(item.stalker_item, {
        id: item.id,
        title: item.title,
        type: item.type,
        category_id: item.category_id,
        poster_url: item.poster_url,
    });
    const stalkerId = extractStalkerItemId(stalkerItem, item.playlist_id);

    return normalizeCollectionDetailItem({
        uid: buildCollectionUid('stalker', item.playlist_id, stalkerId),
        name: item.title,
        contentType: item.type,
        sourceType: 'stalker',
        playlistId: item.playlist_id,
        playlistName: item.playlist_name ?? '',
        posterUrl: item.poster_url ?? null,
        stalkerId,
        categoryId: item.category_id,
        stalkerItem,
        addedAt: 'added_at' in item ? item.added_at : undefined,
        viewedAt: 'viewed_at' in item ? item.viewed_at : undefined,
    });
}

export function buildStalkerStateItem(
    rawItem: StalkerPortalItem | undefined,
    fallback: {
        id: string | number;
        title: string;
        type: PortalActivityType;
        category_id?: string | number | null;
        poster_url?: string;
    }
): Record<string, unknown> {
    const normalizedCategory =
        toOptionalPathSegment(rawItem?.category_id) ??
        toOptionalPathSegment(fallback.category_id) ??
        toStalkerCategoryId(fallback.type);
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

function toOptionalPathSegment(value: unknown): string | undefined {
    const normalized = toPathSegment(value);
    return normalized ? normalized : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) {
        return undefined;
    }

    const normalized = Number(rawValue);
    return Number.isFinite(normalized) ? normalized : undefined;
}

function normalizeCollectionDetailItem(
    candidate: unknown
): UnifiedCollectionItem | null {
    const record = toStateRecord(candidate);
    if (!record) {
        return null;
    }

    const contentType = toPathSegment(record['contentType']);
    const sourceType = toPathSegment(
        record['sourceType']
    ) as CollectionSourceType;
    const uid = toPathSegment(record['uid']);
    const name = toPathSegment(record['name']);
    const playlistId = toPathSegment(record['playlistId']);

    if (
        !uid ||
        !name ||
        !playlistId ||
        (contentType !== 'movie' && contentType !== 'series') ||
        (sourceType !== 'xtream' && sourceType !== 'stalker')
    ) {
        return null;
    }

    return {
        uid,
        name,
        contentType,
        sourceType,
        playlistId,
        playlistName: toPathSegment(record['playlistName']),
        posterUrl:
            toOptionalPathSegment(record['posterUrl']) ??
            toOptionalPathSegment(record['logo']) ??
            null,
        logo: toOptionalPathSegment(record['logo']) ?? null,
        xtreamId: toOptionalNumber(record['xtreamId']),
        contentId: toOptionalNumber(record['contentId']),
        stalkerId: toOptionalPathSegment(record['stalkerId']),
        stalkerCmd: toOptionalPathSegment(record['stalkerCmd']),
        stalkerPortalUrl: toOptionalPathSegment(record['stalkerPortalUrl']),
        stalkerMacAddress: toOptionalPathSegment(record['stalkerMacAddress']),
        categoryId: toOptionalPathSegment(record['categoryId']),
        rating: toOptionalPathSegment(record['rating']),
        addedAt: toOptionalPathSegment(record['addedAt']),
        viewedAt: toOptionalPathSegment(record['viewedAt']),
        position: toOptionalNumber(record['position']),
        stalkerItem: toStateRecord(record['stalkerItem']) ?? undefined,
    };
}

function buildCollectionRoute(
    sourceType: CollectionSourceType,
    playlistId: string,
    mode: 'favorites' | 'recent'
): string[] {
    if (sourceType === 'xtream') {
        return ['/workspace', 'xtreams', playlistId, mode];
    }

    if (sourceType === 'stalker') {
        return ['/workspace', 'stalker', playlistId, mode];
    }

    return ['/workspace', 'playlists', playlistId, mode];
}

function toStateRecord(state: unknown): Record<string, unknown> | null {
    return state && typeof state === 'object'
        ? (state as Record<string, unknown>)
        : null;
}
