import {
    getXtreamVodInfo,
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import {
    resolveXtreamVodPlaybackSource,
    XtreamVodPlaybackItem,
} from '../services/xtream-vod-playback-source';
import {
    collectionSnapshotMatchesContent,
    CollectionIdentity,
} from '../data-sources/pwa-collection-identity';
import { stripXtreamVodInfoPlaceholders } from './xtream-detail-metadata';
import { xtreamDetailContentMetadata } from '../xtream-content-metadata.util';

export type XtreamVodSelection = XtreamVodDetails & {
    [key: string]: unknown;
    container_extension?: string | null;
    stream_id: string | number;
    xtream_id: number;
};

export interface XtreamVodCatalogCategory {
    readonly category_id?: string | number;
    readonly id?: string | number;
    readonly xtream_id?: string | number;
}

export function buildXtreamVodSelection(
    vodDetails: XtreamVodDetails | null | undefined,
    catalogItem: XtreamVodStream | undefined,
    vodId: string | number,
    recoveredCatalogItem?: XtreamVodStream
): XtreamVodSelection {
    vodDetails ??= { info: [] };
    const detailStreamId =
        vodDetails.movie_data?.stream_id ??
        (vodDetails as XtreamVodPlaybackItem).stream_id;
    if (detailStreamId != null && Number(detailStreamId) !== Number(vodId)) {
        vodDetails = { info: [] };
    }
    const info = getXtreamVodInfo(vodDetails);
    const identity = xtreamDetailContentMetadata(info);
    const matches = (item: XtreamVodStream | undefined): boolean => {
        if (
            !item ||
            Number(item.xtream_id ?? item.stream_id) !== Number(vodId) ||
            (item.stream_id != null && Number(item.stream_id) !== Number(vodId))
        )
            return false;
        return collectionSnapshotMatchesContent(
            {
                tmdb_id: identity?.tmdbId,
                release_year: identity?.releaseYear,
            },
            item as XtreamVodStream & CollectionIdentity,
            true
        );
    };
    // A provider may reuse a numeric ID. Known conflicting catalog evidence
    // cannot supply playback fields or presentation for this detail.
    catalogItem = matches(catalogItem) ? catalogItem : undefined;
    recoveredCatalogItem = matches(recoveredCatalogItem)
        ? recoveredCatalogItem
        : undefined;
    const detailItem = vodDetails as XtreamVodPlaybackItem;
    const detailSource = resolveXtreamVodPlaybackSource(detailItem);
    const playbackSource =
        (detailSource?.streamId === Number(vodId) ? detailSource : null) ??
        resolveXtreamVodPlaybackSource(
            recoveredCatalogItem as unknown as XtreamVodPlaybackItem
        ) ??
        resolveXtreamVodPlaybackSource(
            catalogItem as unknown as XtreamVodPlaybackItem
        );
    return {
        ...catalogItem,
        ...recoveredCatalogItem,
        ...vodDetails,
        ...(info ? { info: stripXtreamVodInfoPlaceholders(info) } : {}),
        stream_id: playbackSource?.streamId ?? Number(vodId),
        container_extension: playbackSource?.containerExtension ?? null,
        direct_source: playbackSource?.directSource ?? '',
        xtream_id: Number(vodId),
    };
}

export function findXtreamVodCatalogItem(
    items: readonly XtreamVodStream[],
    vodId: string | number
): XtreamVodStream | undefined {
    return items.find((item) => {
        const candidateId =
            item.xtream_id ??
            item.stream_id ??
            (item as { id?: string | number }).id;

        return Number(candidateId) === Number(vodId);
    });
}

export function resolveXtreamVodCatalogCategoryId(
    categories: readonly XtreamVodCatalogCategory[],
    categoryId: string | number
): string | number | null {
    return (
        resolveXtreamVodCatalogCategoryIds(categories, categoryId)[0] ?? null
    );
}

export function resolveXtreamVodCatalogCategoryIds(
    categories: readonly XtreamVodCatalogCategory[],
    categoryId: string | number
): (string | number)[] {
    const normalizedCategoryId = Number(categoryId);
    if (!Number.isFinite(normalizedCategoryId)) {
        return [];
    }

    const candidates: (string | number)[] = [];
    const seen = new Set<number>();
    const addProviderId = (category: XtreamVodCatalogCategory): void => {
        const providerId = category.xtream_id ?? category.category_id;
        if (providerId === undefined || providerId === null) {
            return;
        }
        const normalizedProviderId = Number(providerId);
        if (
            Number.isFinite(normalizedProviderId) &&
            !seen.has(normalizedProviderId)
        ) {
            seen.add(normalizedProviderId);
            candidates.push(providerId);
        }
    };
    const matches = (value: string | number | undefined): boolean =>
        value !== undefined && Number(value) === normalizedCategoryId;

    categories
        .filter((item) => item.xtream_id !== undefined && matches(item.id))
        .forEach(addProviderId);
    categories
        .filter((item) => matches(item.xtream_id) || matches(item.category_id))
        .forEach(addProviderId);

    return candidates;
}
