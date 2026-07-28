import { XtreamVodStream } from '@iptvnator/shared/interfaces';
import { XtreamCredentials } from '../services/xtream-api.service';
import {
    resolveXtreamVodCatalogCategoryId,
    XtreamVodCatalogCategory,
} from './xtream-vod-selection';

type PlaylistId = string | null | undefined;

export function createXtreamDetailsRequestGuard(
    getCurrentPlaylistId: () => PlaylistId
) {
    let generation = 0;

    return {
        begin(expectedPlaylistId: string): () => boolean {
            const requestGeneration = ++generation;
            return () =>
                requestGeneration === generation &&
                getCurrentPlaylistId() === expectedPlaylistId;
        },
        invalidate(): void {
            generation += 1;
        },
    };
}

interface RecoverXtreamVodCatalogItemOptions {
    readonly apiService: {
        getVodStream(
            credentials: XtreamCredentials,
            vodId: string | number,
            categoryId: string | number
        ): Promise<XtreamVodStream | null>;
    };
    readonly currentCategories: readonly XtreamVodCatalogCategory[];
    readonly credentials: XtreamCredentials;
    readonly dataSource: {
        getAllCategories(
            playlistId: string,
            type: 'movies'
        ): Promise<readonly XtreamVodCatalogCategory[]>;
        getCategories(
            playlistId: string,
            credentials: XtreamCredentials,
            type: 'vod'
        ): Promise<readonly XtreamVodCatalogCategory[]>;
    };
    readonly isCurrent: () => boolean;
    readonly playlistId: string;
    readonly routeCategoryId: string | number;
    readonly vodId: string | number;
}

export async function recoverXtreamVodCatalogItem({
    apiService,
    currentCategories,
    credentials,
    dataSource,
    isCurrent,
    playlistId,
    routeCategoryId,
    vodId,
}: RecoverXtreamVodCatalogItemOptions): Promise<XtreamVodStream | null> {
    if (!isCurrent()) {
        return null;
    }

    let providerCategoryId = resolveXtreamVodCatalogCategoryId(
        currentCategories,
        routeCategoryId
    );
    if (providerCategoryId === null) {
        const persistedCategories = await dataSource.getAllCategories(
            playlistId,
            'movies'
        );
        if (!isCurrent()) {
            return null;
        }
        providerCategoryId = resolveXtreamVodCatalogCategoryId(
            persistedCategories,
            routeCategoryId
        );
    }

    if (providerCategoryId === null) {
        const categories = await dataSource.getCategories(
            playlistId,
            credentials,
            'vod'
        );
        if (!isCurrent()) {
            return null;
        }
        providerCategoryId = resolveXtreamVodCatalogCategoryId(
            categories,
            routeCategoryId
        );
    }

    if (providerCategoryId === null || !isCurrent()) {
        return null;
    }

    const item = await apiService.getVodStream(
        credentials,
        vodId,
        providerCategoryId
    );
    return isCurrent() ? item : null;
}
