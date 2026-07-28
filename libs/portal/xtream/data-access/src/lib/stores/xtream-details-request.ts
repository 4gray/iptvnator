import {
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import { XtreamCredentials } from '../services/xtream-api.service';
import { resolveXtreamVodPlaybackSource } from '../services/xtream-vod-playback-source';
import {
    buildXtreamVodSelection,
    findXtreamVodCatalogItem,
    resolveXtreamVodCatalogCategoryId,
    XtreamVodCatalogCategory,
    XtreamVodSelection,
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

interface ResolveXtreamVodDetailsSelectionOptions extends Omit<
    RecoverXtreamVodCatalogItemOptions,
    'currentCategories'
> {
    readonly currentCategories: readonly XtreamVodCatalogCategory[];
    readonly currentCategoriesPlaylistId: PlaylistId;
    readonly currentStreams: readonly XtreamVodStream[];
    readonly currentStreamsPlaylistId: PlaylistId;
    readonly vodDetails: XtreamVodDetails;
}

export interface ResolveXtreamVodDetailsSelectionResult {
    readonly recoveryError?: unknown;
    readonly selection: XtreamVodSelection;
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

export async function resolveXtreamVodDetailsSelection({
    currentCategories,
    currentCategoriesPlaylistId,
    currentStreams,
    currentStreamsPlaylistId,
    vodDetails,
    ...recoveryOptions
}: ResolveXtreamVodDetailsSelectionOptions): Promise<ResolveXtreamVodDetailsSelectionResult> {
    const catalogItem =
        currentStreamsPlaylistId === recoveryOptions.playlistId
            ? findXtreamVodCatalogItem(currentStreams, recoveryOptions.vodId)
            : undefined;
    const selection = buildXtreamVodSelection(
        vodDetails,
        catalogItem,
        recoveryOptions.vodId
    );

    if (resolveXtreamVodPlaybackSource(selection)) {
        return { selection };
    }

    try {
        const recoveredCatalogItem = await recoverXtreamVodCatalogItem({
            ...recoveryOptions,
            currentCategories:
                currentCategoriesPlaylistId === recoveryOptions.playlistId
                    ? currentCategories
                    : [],
        });

        return {
            selection: recoveredCatalogItem
                ? buildXtreamVodSelection(
                      vodDetails,
                      catalogItem,
                      recoveryOptions.vodId,
                      recoveredCatalogItem
                  )
                : selection,
        };
    } catch (recoveryError) {
        return { recoveryError, selection };
    }
}
