import {
    XTREAM_CONTENT_TYPES,
    normalizeXtreamContentTypes,
} from '@iptvnator/shared/interfaces';
import type { Injector } from '@angular/core';
import type {
    DatabaseService,
    XCategoryFromDb,
    PlaybackPositionService,
    VodSourcePinService,
} from '@iptvnator/services';
import type {
    XtreamContentType,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';
import {
    XtreamDeferredCatalogRestoreService,
    prepareLegacyCatalogHistoryRecovery,
    resolveAvailableCatalogs,
    beginCatalogHistoryRecovery,
    readCatalogHistoryRecovery,
    clearCatalogHistoryRecovery,
    completeCatalogHistoryRecovery,
    completeExplicitCatalogHistoryRestore,
    explicitCatalogHistoryForReplay,
    clearExplicitCatalogVisibility,
    explicitCategoryVisibilityForReplay,
} from '@iptvnator/services/xtream-catalog-restore';
import type { XtreamOperationOptions } from './xtream-data-source.interface';

// Local dynamic-import target: keep restoration-only work off the startup path.
export { XtreamDeferredCatalogRestoreService } from '@iptvnator/services/xtream-catalog-restore';
export {
    resolveAvailableCatalogs,
    prepareLegacyCatalogHistoryRecovery,
    clearCatalogHistoryRecovery,
} from '@iptvnator/services/xtream-catalog-restore';

/** Full recovery is cold work; keep it outside the warm-cache data-source module. */
export async function prepareElectronFavoriteRestore(
    db: DatabaseService,
    injector: Injector,
    playlistId: string,
    state: XtreamPendingRestoreState
): Promise<void> {
    if (state.preservePlaybackPositions)
        await prepareLegacyCatalogHistoryRecovery(
            db,
            injector.get(XtreamDeferredCatalogRestoreService),
            playlistId,
            state
        );
    else await clearExplicitCatalogVisibility(db, playlistId);
}

export async function restoreElectronUserData(
    services: {
        db: DatabaseService;
        playback: PlaybackPositionService;
        pins: VodSourcePinService;
        injector: Injector;
        getPlaylist: (
            id: string
        ) => Promise<{ xtreamContentTypes?: XtreamContentType[] } | null>;
        restoreFavorites: (
            id: string,
            state: XtreamPendingRestoreState
        ) => Promise<void>;
    },
    playlistId: string,
    restoreState: XtreamPendingRestoreState,
    options?: XtreamOperationOptions
): Promise<void> {
    services.playback.assertSupportsAtomicReplacement();
    const archiveHistory = restoreState.recentlyViewed;
    const archiveVisibility = restoreState.hiddenCategories;
    const deferred = services.injector.get(XtreamDeferredCatalogRestoreService);
    if (restoreState.preservePlaybackPositions)
        await prepareLegacyCatalogHistoryRecovery(
            services.db,
            deferred,
            playlistId,
            restoreState
        );
    else await clearCatalogHistoryRecovery(services.db, playlistId);
    const categories = await Promise.all(
        (['live', 'movies', 'series'] as const).map((type) =>
            services.db.getAllXtreamCategories(playlistId, type)
        )
    );
    const enabled = normalizeXtreamContentTypes(
        (await services.getPlaylist(playlistId))?.xtreamContentTypes
    );
    const available = await resolveAvailableCatalogs(
        services.db,
        playlistId,
        enabled
    );
    const prepared = await prepareUserDataRestore(
        services.db,
        deferred,
        playlistId,
        restoreState,
        available
    );
    restoreState = prepared.state;
    if (!restoreState.preservePlaybackPositions)
        await restoreCategoryVisibility(
            services.db,
            playlistId,
            categories,
            explicitCategoryVisibilityForReplay(
                prepared.snapshot,
                archiveVisibility
            )
        );
    await services.restoreFavorites(playlistId, restoreState);
    const restored = await services.db.restoreXtreamUserData(
        playlistId,
        [],
        restoreState.preservePlaybackPositions
            ? restoreState.recentlyViewed
            : explicitCatalogHistoryForReplay(
                  prepared.snapshot,
                  archiveHistory
              ),
        options
    );
    if (!restoreState.preservePlaybackPositions)
        await services.playback.replaceAllPlaybackPositions(
            playlistId,
            restoreState.playbackPositions
        );
    if (restoreState.sourcePins) {
        const replaced = await services.pins.replaceForPlaylist(
            playlistId,
            restoreState.sourcePins.map((pin) => ({
                matchKey: pin.matchKey,
                playlistId,
                contentId: pin.contentId,
                portalType: 'xtream' as const,
                ...(pin.updatedAt ? { updatedAt: pin.updatedAt } : {}),
            }))
        );
        if (!replaced)
            throw new Error(
                `Restoring the pinned sources for "${playlistId}" failed.`
            );
    }
    if (restoreState.preservePlaybackPositions)
        await completeCatalogHistoryRecovery(
            services.db,
            deferred,
            playlistId,
            prepared.snapshot,
            available
        );
    else
        await completeExplicitCatalogHistoryRestore(
            services.db,
            deferred,
            playlistId,
            prepared.snapshot,
            available,
            restored
        );
}

/** Native registration owns live history; pending JSON never overwrites newer actions. */
export async function prepareUserDataRestore(
    db: DatabaseService,
    deferred: XtreamDeferredCatalogRestoreService,
    playlistId: string,
    state: XtreamPendingRestoreState,
    available: readonly XtreamContentType[]
) {
    if (state.preservePlaybackPositions) {
        const original = deferred.getSnapshot(playlistId);
        const owned = state.catalogSnapshot;
        const owns = owned
            ? owned.key === original.key &&
              owned.generation === original.generation
            : original.generation === null || original.generation === 'legacy';
        await beginCatalogHistoryRecovery(
            db,
            playlistId,
            [...XTREAM_CONTENT_TYPES],
            owns && owned ? original.state.recentlyViewed : []
        );
        const current = await readCatalogHistoryRecovery(db, playlistId);
        if (!current)
            throw new Error('Catalog history recovery is unavailable.');
        state = { ...state, recentlyViewed: current.recentlyViewed };
        const latest = deferred.getSnapshot(playlistId);
        if (!owns || latest.key !== original.key || latest.raw !== original.raw)
            return {
                state: {
                    ...state,
                    recentlyViewed: state.recentlyViewed.filter((row) =>
                        available.includes(row.contentType)
                    ),
                },
                // Never consume a record this import did not capture.
                snapshot: { key: '', raw: null, generation: null, state },
            };
    }
    return deferred.prepare(
        playlistId,
        state,
        available,
        false,
        !!state.preservePlaybackPositions
    );
}

export async function restoreCategoryVisibility(
    db: Pick<DatabaseService, 'updateCategoryVisibility'>,
    playlistId: string,
    categoriesByType: XCategoryFromDb[][],
    hiddenCategories: XtreamPendingRestoreState['hiddenCategories']
): Promise<void> {
    for (const categories of categoriesByType) {
        if (categories.length === 0) {
            continue;
        }

        const reset = await db.updateCategoryVisibility(
            categories.map((category) => category.id),
            false
        );
        if (!reset) {
            throw new Error(
                `Resetting category visibility for "${playlistId}" failed.`
            );
        }

        const hiddenCategoryIds = categories
            .filter((category) =>
                hiddenCategories.some(
                    (hiddenCategory) =>
                        hiddenCategory.categoryType === category.type &&
                        hiddenCategory.xtreamId === category.xtream_id
                )
            )
            .map((category) => category.id);
        if (
            hiddenCategoryIds.length > 0 &&
            !(await db.updateCategoryVisibility(hiddenCategoryIds, true))
        ) {
            throw new Error(
                `Restoring category visibility for "${playlistId}" failed.`
            );
        }
    }
}

/** Legacy cache-snapshot API is cold work too; keep its existing semantics. */
export async function clearElectronCatalogCache(
    services: {
        db: Pick<DatabaseService, 'deleteXtreamPlaylistContent'>;
        playback: Pick<PlaybackPositionService, 'getAllPlaybackPositions'>;
        pins: Pick<VodSourcePinService, 'listForPlaylist'>;
        getPlaylist: (
            id: string
        ) => Promise<{ xtreamContentTypes?: XtreamContentType[] } | null>;
    },
    playlistId: string
): Promise<XtreamPendingRestoreState> {
    const playlist = await services.getPlaylist(playlistId);
    const [result, playbackPositions, sourcePins] = await Promise.all([
        services.db.deleteXtreamPlaylistContent(playlistId, {
            contentTypes: playlist?.xtreamContentTypes,
        }),
        services.playback.getAllPlaybackPositions(playlistId),
        services.pins.listForPlaylist(playlistId),
    ]);

    return {
        hiddenCategories: result.hiddenCategories,
        favorites: result.favorites,
        recentlyViewed: result.recentlyViewed,
        playbackPositions,
        sourcePins: sourcePins.map((pin) => ({
            matchKey: pin.matchKey,
            contentId: pin.contentId,
            ...(pin.updatedAt ? { updatedAt: pin.updatedAt } : {}),
        })),
    };
}
