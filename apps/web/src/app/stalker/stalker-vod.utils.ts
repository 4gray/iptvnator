import {
    signal,
    WritableSignal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { PlaylistsService } from 'services';
import {
    createStalkerVodItem,
    StalkerVodDetails,
    StalkerVodInfo,
    VodDetailsItem,
} from 'shared-interfaces';
import {
    StalkerFavoriteItem,
    StalkerSelectedVodItem,
    StalkerSeriesFlag,
    StalkerVodSource,
} from './models/stalker-favorite-item.interface';

export interface StalkerDetailViewState {
    itemDetails: StalkerSelectedVodItem | null;
    vodDetailsItem: VodDetailsItem | null;
}

export interface StalkerFavoriteToggleEvent {
    item: VodDetailsItem;
    isFavorite: boolean;
}

export interface StalkerFavoriteToggleOptions {
    addToFavorites: (
        item: Record<string, unknown>,
        onComplete?: () => void
    ) => void;
    removeFromFavorites: (
        favoriteId: string,
        onComplete?: () => void
    ) => void;
    onComplete?: () => void;
}

export function isStalkerSeriesFlag(value: unknown): boolean {
    return value === true || value === 1 || value === '1';
}

export function normalizeStalkerSeriesFlag(
    value: unknown
): StalkerSeriesFlag | undefined {
    if (value === true || value === 1 || value === '1') {
        return true;
    }
    return undefined;
}

export function isStalkerSeriesItem(item: {
    is_series?: unknown;
    series?: unknown;
}): boolean {
    return (
        isStalkerSeriesFlag(item?.is_series) ||
        (Array.isArray(item?.series) && item.series.length > 0)
    );
}

export function buildStalkerFavoritePayload(
    data: StalkerVodDetails
): Record<string, unknown> {
    return {
        ...data,
        category_id: 'vod',
        title: data.info?.name,
        cover: data.info?.movie_image,
        added_at: new Date().toISOString(),
    };
}

export function matchesFavoriteById(
    favorite: Partial<StalkerFavoriteItem>,
    itemId: string | number
): boolean {
    const expectedId = normalizeStalkerEntityId(itemId);
    return (
        normalizeStalkerEntityId(favorite?.id) === expectedId ||
        normalizeStalkerEntityId(favorite?.movie_id) === expectedId ||
        normalizeStalkerEntityId(favorite?.stream_id) === expectedId ||
        normalizeStalkerEntityId(favorite?.series_id) === expectedId
    );
}

export function normalizeStalkerEntityId(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).trim();
}

export function normalizeStalkerEntityIdAsNumber(
    value: unknown
): number | null {
    const normalized = normalizeStalkerEntityId(value);
    if (!normalized) {
        return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrFallback(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return fallback;
    return String(value);
}

function toOptionalString(value: unknown): string | undefined {
    if (value === null || value === undefined || value === '') {
        return undefined;
    }
    return String(value);
}

export function createStalkerInfo(item: StalkerVodSource): StalkerVodInfo {
    const info = item.info ?? {};

    return {
        name: toStringOrFallback(
            info.name ?? info.o_name ?? item.o_name ?? item.name ?? item.title,
            'Unknown'
        ),
        o_name: toOptionalString(info.o_name ?? item.o_name),
        movie_image: toStringOrFallback(
            info.movie_image ?? item.cover ?? item.screenshot_uri ?? item.logo
        ),
        description: toStringOrFallback(info.description ?? item.description),
        actors: toStringOrFallback(info.actors ?? item.actors),
        director: toStringOrFallback(info.director ?? item.director),
        releasedate: toStringOrFallback(
            info.releasedate ?? item.releasedate ?? item.year
        ),
        genre: toStringOrFallback(info.genre ?? item.genre ?? item.genres_str),
        rating_imdb: toStringOrFallback(info.rating_imdb ?? item.rating_imdb),
        rating_kinopoisk: toStringOrFallback(
            info.rating_kinopoisk ?? item.rating_kinopoisk
        ),
    };
}

export function buildStalkerSelectedVodItem(
    item: StalkerVodSource,
    forceSeries = false
): StalkerSelectedVodItem {
    return {
        id: toStringOrFallback(item.id ?? item.stream_id),
        cmd: toStringOrFallback(item.cmd),
        series: item.series,
        has_files: item.has_files,
        is_series:
            forceSeries || isStalkerSeriesFlag(item?.is_series)
                ? true
                : undefined,
        video_id: item.video_id,
        category_id:
            typeof item.category_id === 'string'
                ? item.category_id
                : undefined,
        info: createStalkerInfo(item),
    };
}

export interface NormalizedStalkerFavoriteItem extends StalkerFavoriteItem {
    details: StalkerSelectedVodItem;
}

export function normalizeStalkerFavoriteItem(
    item: StalkerFavoriteItem
): NormalizedStalkerFavoriteItem {
    if (item.details && item.details.info) {
        return item as NormalizedStalkerFavoriteItem;
    }

    const source = (item.details || item) as StalkerVodSource;
    const info = createStalkerInfo({
        ...item,
        ...source,
    });
    const normalizedIsSeries = normalizeStalkerSeriesFlag(
        (item as StalkerVodSource).is_series ?? source.is_series
    );

    return {
        ...item,
        details: {
            ...source,
            info,
            cmd: toStringOrFallback(
                (item as StalkerVodSource).cmd ?? source.cmd
            ),
            id: toStringOrFallback(item.stream_id ?? item.id ?? source.id),
            series: (item as StalkerVodSource).series ?? source.series,
            is_series: normalizedIsSeries ? true : undefined,
            video_id:
                (item as StalkerVodSource).video_id ?? source.video_id,
            category_id:
                typeof (item as StalkerVodSource).category_id === 'string'
                    ? (item as StalkerVodSource).category_id
                    : typeof source.category_id === 'string'
                      ? source.category_id
                      : undefined,
        },
    };
}

export function normalizeStalkerVodDetailsItem(
    item: StalkerVodSource
): StalkerSelectedVodItem {
    return {
        ...buildStalkerSelectedVodItem(item),
        info: createStalkerInfo(item),
        is_series: normalizeStalkerSeriesFlag(item?.is_series)
            ? true
            : undefined,
    };
}

export function createStalkerDetailViewState(
    normalizedItem: StalkerSelectedVodItem,
    playlistId: string
): StalkerDetailViewState {
    if (isStalkerSeriesItem(normalizedItem)) {
        return {
            itemDetails: normalizedItem,
            vodDetailsItem: null,
        };
    }

    return {
        itemDetails: normalizedItem,
        vodDetailsItem: createStalkerVodItem(
            normalizedItem as StalkerVodDetails,
            playlistId
        ),
    };
}

export function clearStalkerDetailViewState(): StalkerDetailViewState {
    return {
        itemDetails: null,
        vodDetailsItem: null,
    };
}

export function createRefreshTrigger(): {
    refreshVersion: WritableSignal<number>;
    refresh: () => void;
} {
    const refreshVersion = signal<number>(Date.now());
    return {
        refreshVersion,
        refresh: () => refreshVersion.set(Date.now()),
    };
}

export function createPortalFavoritesResource(
    playlistService: PlaylistsService,
    getPortalId: () => string | undefined,
    getRefreshVersion: () => number
) {
    return createPortalCollectionResource(
        playlistService,
        getPortalId,
        getRefreshVersion,
        (service, portalId) => service.getPortalFavorites(portalId)
    );
}

export function createPortalCollectionResource<T>(
    playlistService: PlaylistsService,
    getPortalId: () => string | undefined,
    getRefreshVersion: () => number,
    streamFactory: (
        playlistService: PlaylistsService,
        portalId: string
    ) => Observable<T[]>
) {
    return rxResource({
        params: () => {
            const portalId = getPortalId();
            if (!portalId) return undefined;
            return {
                portalId,
                refreshVersion: getRefreshVersion(),
            };
        },
        stream: ({ params }) =>
            streamFactory(playlistService, params.portalId),
    });
}

export function isSelectedStalkerVodFavorite(
    item: VodDetailsItem | null,
    favorites: ReadonlyArray<StalkerFavoriteItem> | undefined
): boolean {
    if (!item || item.type !== 'stalker') {
        return false;
    }

    return (favorites ?? []).some((favorite) =>
        matchesFavoriteById(favorite, item.data.id)
    );
}

export function toggleStalkerVodFavorite(
    event: StalkerFavoriteToggleEvent,
    options: StalkerFavoriteToggleOptions
): void {
    if (event.item.type !== 'stalker') {
        return;
    }

    if (event.isFavorite) {
        options.addToFavorites(
            buildStalkerFavoritePayload(event.item.data),
            options.onComplete
        );
    } else {
        options.removeFromFavorites(event.item.data.id, options.onComplete);
    }
}
