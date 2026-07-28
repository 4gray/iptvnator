import {
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import { XtreamVodPlaybackItem } from '../services/xtream-vod-playback-source';

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
    vodId: string | number
): XtreamVodSelection {
    const detailItem = vodDetails as XtreamVodPlaybackItem;

    return {
        ...catalogItem,
        ...vodDetails,
        stream_id:
            catalogItem?.stream_id ?? detailItem.stream_id ?? Number(vodId),
        container_extension:
            catalogItem?.container_extension ??
            detailItem.container_extension ??
            null,
        xtream_id: catalogItem?.xtream_id ?? Number(vodId),
    };
}

export function resolveXtreamVodCatalogCategoryId(
    categories: readonly XtreamVodCatalogCategory[],
    categoryId: string | number
): string | number | null {
    const category = categories.find(
        (item) => Number(item.id ?? item.category_id) === Number(categoryId)
    );

    return category?.xtream_id ?? category?.category_id ?? null;
}
