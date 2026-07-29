import {
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import { XtreamCredentials } from '../services/xtream-api.service';
import { resolveXtreamVodPlaybackSource } from '../services/xtream-vod-playback-source';
import {
    buildXtreamVodSelection,
    findXtreamVodCatalogItem,
    resolveXtreamVodCatalogCategoryIds,
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
    readonly recovery: Promise<XtreamVodDetailsRecoveryResult> | null;
    readonly selection: XtreamVodSelection;
}

export interface XtreamVodDetailsRecoveryResult {
    readonly recoveredCatalogItem: XtreamVodStream | null;
    readonly recoveryError?: unknown;
    readonly selection: XtreamVodSelection;
}

export function applyRecoveredXtreamVodCatalogItem(
    currentSelection: {
        readonly [key: string]: unknown;
        readonly stream_id?: string | number;
        readonly xtream_id?: number;
    } | null,
    recoveredCatalogItem: XtreamVodStream | null,
    vodId: string | number
): XtreamVodSelection | null {
    const currentVodId =
        currentSelection?.xtream_id ?? currentSelection?.stream_id;
    if (
        !currentSelection ||
        !recoveredCatalogItem ||
        Number(currentVodId) !== Number(vodId)
    ) {
        return null;
    }

    return buildXtreamVodSelection(
        currentSelection as XtreamVodDetails,
        undefined,
        vodId,
        recoveredCatalogItem
    );
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

    const attemptedCategoryIds = new Set<number>();
    const findInCategories = async (
        categories: readonly XtreamVodCatalogCategory[]
    ): Promise<XtreamVodStream | null> => {
        const providerCategoryIds = resolveXtreamVodCatalogCategoryIds(
            categories,
            routeCategoryId
        );
        for (const providerCategoryId of providerCategoryIds) {
            const normalizedProviderId = Number(providerCategoryId);
            if (attemptedCategoryIds.has(normalizedProviderId)) {
                continue;
            }
            attemptedCategoryIds.add(normalizedProviderId);
            if (!isCurrent()) {
                return null;
            }

            const item = await apiService.getVodStream(
                credentials,
                vodId,
                providerCategoryId
            );
            if (!isCurrent()) {
                return null;
            }
            if (item) {
                return item;
            }
        }

        return null;
    };

    let item = await findInCategories(currentCategories);
    if (item || !isCurrent()) {
        return item;
    }

    const persistedCategories = await dataSource.getAllCategories(
        playlistId,
        'movies'
    );
    if (!isCurrent()) {
        return null;
    }
    item = await findInCategories(persistedCategories);
    if (item || !isCurrent()) {
        return item;
    }

    const categories = await dataSource.getCategories(
        playlistId,
        credentials,
        'vod'
    );
    if (!isCurrent()) {
        return null;
    }

    return findInCategories(categories);
}

export function resolveXtreamVodDetailsSelection({
    currentCategories,
    currentCategoriesPlaylistId,
    currentStreams,
    currentStreamsPlaylistId,
    vodDetails,
    ...recoveryOptions
}: ResolveXtreamVodDetailsSelectionOptions): ResolveXtreamVodDetailsSelectionResult {
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
        return { recovery: null, selection };
    }

    const recovery = recoverXtreamVodCatalogItem({
        ...recoveryOptions,
        currentCategories:
            currentCategoriesPlaylistId === recoveryOptions.playlistId
                ? currentCategories
                : [],
    })
        .then((recoveredCatalogItem) => ({
            recoveredCatalogItem,
            selection: recoveredCatalogItem
                ? buildXtreamVodSelection(
                      vodDetails,
                      catalogItem,
                      recoveryOptions.vodId,
                      recoveredCatalogItem
                  )
                : selection,
        }))
        .catch((recoveryError: unknown) => ({
            recoveredCatalogItem: null,
            recoveryError,
            selection,
        }));

    return {
        recovery,
        selection,
    };
}
