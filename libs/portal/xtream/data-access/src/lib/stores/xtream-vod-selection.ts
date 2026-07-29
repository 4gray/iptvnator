import {
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import {
    resolveXtreamVodPlaybackSource,
    XtreamVodPlaybackItem,
} from '../services/xtream-vod-playback-source';

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
    vodDetails: XtreamVodDetails,
    catalogItem: XtreamVodStream | undefined,
    vodId: string | number,
    recoveredCatalogItem?: XtreamVodStream
): XtreamVodSelection {
    const detailItem = vodDetails as XtreamVodPlaybackItem;
    const playbackSource =
        resolveXtreamVodPlaybackSource(detailItem) ??
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
        stream_id: playbackSource?.streamId ?? Number(vodId),
        container_extension: playbackSource?.containerExtension ?? null,
        xtream_id:
            recoveredCatalogItem?.xtream_id ??
            catalogItem?.xtream_id ??
            Number(vodId),
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
