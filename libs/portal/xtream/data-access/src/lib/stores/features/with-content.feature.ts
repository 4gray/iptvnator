import { computed, inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import {
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from 'shared-interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    DatabaseService,
    DbOperationEvent,
    isDbAbortError,
    XtreamImportStatus,
} from 'services';
import {
    DbCategoryType,
    XTREAM_DATA_SOURCE,
    XtreamCategoryFromDb,
} from '../../data-sources/xtream-data-source.interface';
import {
    XtreamApiService,
    XtreamCredentials,
} from '../../services/xtream-api.service';
import {
    ContentType,
    PortalStatusType,
    XtreamContentInitBlockReason,
    XtreamContentLoadState,
    XtreamContentLoadStateByType,
} from '../../xtream-state';

const cancelledPlaylistInitializationLockKey = (
    playlistId: string
): string => `xtream-init-cancelled:${playlistId}`;

const hasCancelledPlaylistInitializationLock = (
    playlistId: string
): boolean => {
    try {
        return (
            localStorage.getItem(
                cancelledPlaylistInitializationLockKey(playlistId)
            ) === 'true'
        );
    } catch {
        return false;
    }
};

const setCancelledPlaylistInitializationLock = (
    playlistId: string
): void => {
    try {
        localStorage.setItem(
            cancelledPlaylistInitializationLockKey(playlistId),
            'true'
        );
    } catch {
        // Ignore storage write failures; runtime state still carries the block.
    }
};

const clearCancelledPlaylistInitializationLock = (
    playlistId: string
): void => {
    try {
        localStorage.removeItem(
            cancelledPlaylistInitializationLockKey(playlistId)
        );
    } catch {
        // Ignore storage write failures; retry still clears the in-memory block.
    }
};

/**
 * Content state for managing categories and streams
 */
export interface ContentState {
    liveCategories: (XtreamCategory | XtreamCategoryFromDb)[];
    vodCategories: (XtreamCategory | XtreamCategoryFromDb)[];
    serialCategories: (XtreamCategory | XtreamCategoryFromDb)[];
    liveStreams: XtreamLiveStream[];
    vodStreams: XtreamVodStream[];
    serialStreams: XtreamSerieItem[];
    isLoadingCategories: boolean;
    isLoadingContent: boolean;
    isImporting: boolean;
    contentLoadStateByType: XtreamContentLoadStateByType;
    isCancellingImport: boolean;
    importCount: number;
    importPhase: string | null;
    itemsToImport: number;
    activeImportSessionId: string | null;
    activeImportOperationIds: string[];
    isContentInitialized: boolean;
    contentInitBlockReason: XtreamContentInitBlockReason | null;
}

/**
 * Initial content state
 */
const initialContentLoadStateByType: XtreamContentLoadStateByType = {
    live: 'idle',
    vod: 'idle',
    series: 'idle',
};

const initialContentState: ContentState = {
    liveCategories: [],
    vodCategories: [],
    serialCategories: [],
    liveStreams: [],
    vodStreams: [],
    serialStreams: [],
    isLoadingCategories: false,
    isLoadingContent: false,
    isImporting: false,
    contentLoadStateByType: { ...initialContentLoadStateByType },
    isCancellingImport: false,
    importCount: 0,
    importPhase: null,
    itemsToImport: 0,
    activeImportSessionId: null,
    activeImportOperationIds: [],
    isContentInitialized: false,
    contentInitBlockReason: null,
};

/**
 * Content feature store for managing Xtream categories and streams.
 * Handles:
 * - Fetching categories (live, vod, series)
 * - Fetching content/streams (live, movies, series)
 * - Import progress tracking
 */
export function withContent() {
    const logger = createLogger('withContent');
    type ParentPortalStoreLike = {
        currentPlaylist?: () => {
            password: string;
            serverUrl: string;
            username: string;
        } | null;
        playlistId?: () => string | null;
        portalStatus?: () => PortalStatusType;
        checkPortalStatus?: () => Promise<PortalStatusType>;
    };

    return signalStoreFeature(
        withState<ContentState>(initialContentState),

        withComputed((store) => ({
            /**
             * Get categories by content type
             */
            getCategoriesByType: computed(() => {
                return (type: ContentType) => {
                    switch (type) {
                        case 'live':
                            return store.liveCategories();
                        case 'vod':
                            return store.vodCategories();
                        case 'series':
                            return store.serialCategories();
                    }
                };
            }),

            /**
             * Get streams/content by type
             */
            getContentByType: computed(() => {
                return (type: ContentType) => {
                    switch (type) {
                        case 'live':
                            return store.liveStreams();
                        case 'vod':
                            return store.vodStreams();
                        case 'series':
                            return store.serialStreams();
                    }
                };
            }),

            /**
             * Get import count
             */
            getImportCount: computed(() => store.importCount()),

            /**
             * Check if content is being imported
             */
            isContentImporting: computed(() => store.isImporting()),

            /**
             * Current import phase label key source
             */
            currentImportPhase: computed(() => store.importPhase()),
        })),

        withMethods((store) => {
            const dataSource = inject(XTREAM_DATA_SOURCE);
            const databaseService = inject(DatabaseService);
            const xtreamApiService = inject(XtreamApiService);
            const importTypes: ContentType[] = ['live', 'vod', 'series'];
            let activeInitializationPromise: Promise<void> | null = null;

            const updateContentTypeLoadState = (
                type: ContentType,
                loadState: XtreamContentLoadState
            ): void => {
                patchState(store, (state) => ({
                    contentLoadStateByType: {
                        ...state.contentLoadStateByType,
                        [type]: loadState,
                    },
                }));
            };

            const resolveInitBlockReason = (
                portalStatus: PortalStatusType | null | undefined
            ): XtreamContentInitBlockReason | null => {
                switch (portalStatus) {
                    case 'expired':
                    case 'inactive':
                    case 'unavailable':
                        return portalStatus;
                    default:
                        return null;
                }
            };

            const getPortalStore = (): ParentPortalStoreLike =>
                store as ParentPortalStoreLike;

            const createImportAbortError = (): Error => {
                const error = new Error('Xtream import cancelled');
                error.name = 'AbortError';
                return error;
            };

            const throwIfImportCancelled = (
                expectedImportSessionId?: string | null
            ): void => {
                if (
                    store.contentInitBlockReason() === 'cancelled' ||
                    (expectedImportSessionId != null &&
                        store.activeImportSessionId() !== expectedImportSessionId)
                ) {
                    throw createImportAbortError();
                }
            };

            /**
             * Helper to get credentials from parent store
             * This will be provided by the parent store's currentPlaylist
             */
            const getCredentialsFromStore = (): {
                playlistId: string;
                credentials: XtreamCredentials;
            } | null => {
                // Access parent store state (currentPlaylist is from withPortal)
                const storeAny = getPortalStore();
                const playlist = storeAny.currentPlaylist?.();
                const playlistId = storeAny.playlistId?.();

                if (!playlist || !playlistId) {
                    return null;
                }

                return {
                    playlistId,
                    credentials: {
                        serverUrl: playlist.serverUrl,
                        username: playlist.username,
                        password: playlist.password,
                    },
                };
            };

            const hasCompletedOfflineCache = async (
                playlistId: string
            ): Promise<boolean> => {
                const contentTypes: Array<{
                    categoryType: DbCategoryType;
                    contentType: 'live' | 'movie' | 'series';
                }> = [
                    { categoryType: 'live', contentType: 'live' },
                    { categoryType: 'movies', contentType: 'movie' },
                    { categoryType: 'series', contentType: 'series' },
                ];

                const cacheChecks = await Promise.all(
                    contentTypes.map(
                        async ({ categoryType, contentType }) => {
                            const [
                                importStatus,
                                hasCategories,
                                hasContent,
                            ] = await Promise.all([
                                databaseService.getXtreamImportStatus(
                                    playlistId,
                                    contentType
                                ),
                                dataSource.hasCategories(
                                    playlistId,
                                    categoryType
                                ),
                                dataSource.hasContent(playlistId, contentType),
                            ]);

                            return (
                                importStatus === 'completed' &&
                                hasCategories &&
                                hasContent
                            );
                        }
                    )
                );

                return cacheChecks.every(Boolean);
            };

            const trackImportEvent = (event: DbOperationEvent): void => {
                const operationId = event.operationId;

                    if (
                        store.contentInitBlockReason() === 'cancelled' &&
                        event.status !== 'cancelled' &&
                        event.status !== 'error' &&
                        event.status !== 'completed'
                    ) {
                        return;
                    }

                    if (
                        event.status === 'started' ||
                        event.status === 'progress'
                    ) {
                    patchState(store, (state) => ({
                        isImporting: true,
                        importPhase: event.phase ?? state.importPhase,
                    }));
                }

                patchState(store, (state) => ({
                    importPhase: event.phase ?? state.importPhase,
                    activeImportOperationIds:
                        operationId == null
                            ? state.activeImportOperationIds
                            : event.status === 'completed' ||
                                event.status === 'cancelled' ||
                                event.status === 'error'
                              ? state.activeImportOperationIds.filter(
                                    (id) => id !== operationId
                                )
                              : state.activeImportOperationIds.includes(
                                      operationId
                                  )
                                ? state.activeImportOperationIds
                                : [
                                      ...state.activeImportOperationIds,
                                      operationId,
                                  ],
                    isCancellingImport: state.isCancellingImport,
                }));
            };

            const registerImportOperation = (operationId: string): void => {
                patchState(store, (state) => ({
                    activeImportOperationIds: state.activeImportOperationIds.includes(
                        operationId
                    )
                        ? state.activeImportOperationIds
                        : [...state.activeImportOperationIds, operationId],
                }));
            };

            const setImportStatus = async (
                playlistId: string,
                type: ContentType,
                status: XtreamImportStatus
            ): Promise<void> => {
                const importType = type === 'vod' ? 'movie' : type;
                await databaseService.setXtreamImportStatus(
                    playlistId,
                    importType,
                    status
                );
            };

            const clearImportCache = async (
                playlistId: string,
                type: ContentType
            ): Promise<void> => {
                const importType = type === 'vod' ? 'movie' : type;
                await databaseService.clearXtreamImportCache(
                    playlistId,
                    importType
                );
            };

            const finalizePendingImportTypes = async (
                playlistId: string,
                completedTypes: Set<ContentType>,
                status: XtreamImportStatus
            ): Promise<void> => {
                for (const type of importTypes) {
                    if (completedTypes.has(type)) {
                        continue;
                    }

                    await setImportStatus(playlistId, type, status);
                    await clearImportCache(playlistId, type);
                }
            };

            const finalizePendingContentLoadStates = (
                completedTypes: Set<ContentType>,
                loadState: XtreamContentLoadState
            ): void => {
                patchState(store, (state) => {
                    const nextLoadStates = {
                        ...state.contentLoadStateByType,
                    };

                    for (const type of importTypes) {
                        if (completedTypes.has(type)) {
                            continue;
                        }

                        nextLoadStates[type] = loadState;
                    }

                    return {
                        contentLoadStateByType: nextLoadStates,
                    };
                });
            };

            const executeContentInitialization = async (
                ignoreBlockedState = false
            ): Promise<void> => {
                const ctx = getCredentialsFromStore();
                if (!ctx) return;

                if (
                    !ignoreBlockedState &&
                    hasCancelledPlaylistInitializationLock(ctx.playlistId)
                ) {
                    patchState(store, {
                        contentInitBlockReason: 'cancelled',
                    });
                    return;
                }

                // Skip duplicate route-session triggers while initialization is
                // already running. The workspace session currently syncs from
                // multiple entry points during bootstrap, and without this guard
                // Electron can duplicate the same Xtream load work.
                if (
                    (!ignoreBlockedState && store.contentInitBlockReason()) ||
                    store.isCancellingImport() ||
                    store.isContentInitialized() ||
                    store.activeImportSessionId()
                ) {
                    return;
                }

                const importSessionId = databaseService.createOperationId(
                    'xtream-import-session'
                );

                patchState(store, {
                    isImporting: false,
                    isCancellingImport: false,
                    importCount: 0,
                    importPhase: null,
                    itemsToImport: 0,
                    activeImportSessionId: importSessionId,
                    activeImportOperationIds: [],
                    contentLoadStateByType: {
                        live: 'loading',
                        vod: 'loading',
                        series: 'loading',
                    },
                });

                const completedTypes = new Set<ContentType>();

                try {
                    // Electron content persistence maps remote category IDs
                    // to internal DB category rows, so categories must exist
                    // before content import starts.
                    await methods.fetchAllCategories({
                        sessionId: importSessionId,
                    });
                    throwIfImportCancelled(importSessionId);
                    await methods.fetchAllContent({
                        importSessionId,
                        sessionId: importSessionId,
                        completedTypes,
                    });
                    throwIfImportCancelled(importSessionId);

                    // Restore user data if needed
                    const restoreKey = `xtream-restore-${ctx.playlistId}`;
                    const restoreData = localStorage.getItem(restoreKey);
                    if (restoreData) {
                        try {
                            throwIfImportCancelled(importSessionId);
                            const {
                                favoritedXtreamIds,
                                recentlyViewedXtreamIds,
                            } = JSON.parse(restoreData);
                            const restoreOperationId =
                                databaseService.createOperationId(
                                    'xtream-restore'
                                );
                            registerImportOperation(restoreOperationId);
                            patchState(store, {
                                importPhase: 'restoring-favorites',
                            });
                            await dataSource.restoreUserData(
                                ctx.playlistId,
                                favoritedXtreamIds,
                                recentlyViewedXtreamIds,
                                {
                                    onEvent: trackImportEvent,
                                    operationId: restoreOperationId,
                                }
                            );
                            throwIfImportCancelled(importSessionId);
                            localStorage.removeItem(restoreKey);
                        } catch (err) {
                            if (!isDbAbortError(err)) {
                                logger.error(
                                    'Error restoring user data',
                                    err
                                );
                            }
                        }
                    }

                    throwIfImportCancelled(importSessionId);

                    // Mark as initialized so next routings won't re-trigger it
                    clearCancelledPlaylistInitializationLock(ctx.playlistId);
                    patchState(store, {
                        isContentInitialized: true,
                        contentInitBlockReason: null,
                    });
                } catch (error) {
                    if (store.isImporting()) {
                        await finalizePendingImportTypes(
                            ctx.playlistId,
                            completedTypes,
                            isDbAbortError(error) ? 'cancelled' : 'failed'
                        );
                    }

                    finalizePendingContentLoadStates(
                        completedTypes,
                        isDbAbortError(error) ? 'idle' : 'error'
                    );

                    if (isDbAbortError(error)) {
                        patchState(store, (state) => ({
                            contentInitBlockReason:
                                state.contentInitBlockReason ?? 'cancelled',
                        }));
                    } else {
                        patchState(store, {
                            contentInitBlockReason:
                                resolveInitBlockReason(
                                    getPortalStore().portalStatus?.()
                                ) ?? 'error',
                        });
                        logger.error('Error initializing content', error);
                    }
                } finally {
                    patchState(store, {
                        isImporting: false,
                        isCancellingImport: false,
                        importCount: 0,
                        importPhase: null,
                        itemsToImport: 0,
                        activeImportSessionId: null,
                        activeImportOperationIds: [],
                    });
                }
            };

            const runContentInitialization = async (
                ignoreBlockedState = false
            ): Promise<void> => {
                if (activeInitializationPromise) {
                    return activeInitializationPromise;
                }

                const initializationPromise = executeContentInitialization(
                    ignoreBlockedState
                ).finally(() => {
                    if (activeInitializationPromise === initializationPromise) {
                        activeInitializationPromise = null;
                    }
                });

                activeInitializationPromise = initializationPromise;
                return initializationPromise;
            };

            const methods = {
                setContentInitBlockReason(
                    reason: XtreamContentInitBlockReason | null
                ): void {
                    patchState(store, (state) => ({
                        contentInitBlockReason:
                            reason === null &&
                            state.contentInitBlockReason === 'cancelled'
                                ? state.contentInitBlockReason
                                : reason,
                    }));
                },

                /**
                 * Fetch all categories in parallel
                 */
                async fetchAllCategories(
                    options?: { sessionId?: string }
                ): Promise<void> {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) return;

                    patchState(store, { isLoadingCategories: true });

                    try {
                        const [live, vod, series] = await Promise.all([
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'live',
                                {
                                    sessionId: options?.sessionId,
                                    onPhaseChange: (phase) =>
                                        patchState(store, {
                                            isImporting: true,
                                            importPhase: phase,
                                        }),
                                }
                            ),
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'vod',
                                {
                                    sessionId: options?.sessionId,
                                    onPhaseChange: (phase) =>
                                        patchState(store, {
                                            isImporting: true,
                                            importPhase: phase,
                                        }),
                                }
                            ),
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'series',
                                {
                                    sessionId: options?.sessionId,
                                    onPhaseChange: (phase) =>
                                        patchState(store, {
                                            isImporting: true,
                                            importPhase: phase,
                                        }),
                                }
                            ),
                        ]);

                        patchState(store, {
                            liveCategories: live,
                            vodCategories: vod,
                            serialCategories: series,
                            isLoadingCategories: false,
                        });
                    } catch (error) {
                        if (!isDbAbortError(error)) {
                            logger.error('Error fetching categories', error);
                        }
                        patchState(store, { isLoadingCategories: false });
                        throw error;
                    }
                },

                /**
                 * Fetch all content/streams with shared progress tracking
                 */
                async fetchAllContent(
                    options?: {
                        importSessionId?: string;
                        sessionId?: string;
                        completedTypes?: Set<ContentType>;
                    }
                ): Promise<void> {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) return;

                    patchState(store, { isLoadingContent: true });

                    // Track combined progress across all content types
                    let totalItems = 0;
                    let importedItems = 0;

                    const onTotal = (count: number) => {
                        totalItems += count;
                        patchState(store, { itemsToImport: totalItems });
                    };

                    const onProgress = (count: number) => {
                        importedItems += count;
                        patchState(store, { importCount: importedItems });
                    };

                    try {
                        throwIfImportCancelled(options?.importSessionId);
                        const liveOperationId = databaseService.createOperationId(
                            'db-save-content'
                        );
                        registerImportOperation(liveOperationId);

                        const live = (await dataSource.getContent(
                            ctx.playlistId,
                            ctx.credentials,
                            'live',
                            onProgress,
                            onTotal,
                            {
                                operationId: liveOperationId,
                                sessionId: options?.sessionId,
                                onEvent: trackImportEvent,
                                onPhaseChange: (phase) =>
                                    patchState(store, {
                                        isImporting: true,
                                        importPhase: phase,
                                    }),
                            }
                        )) as XtreamLiveStream[];
                        throwIfImportCancelled(options?.importSessionId);
                        await setImportStatus(ctx.playlistId, 'live', 'completed');
                        options?.completedTypes?.add('live');
                        patchState(store, {
                            liveStreams: live,
                        });
                        updateContentTypeLoadState('live', 'ready');

                        throwIfImportCancelled(options?.importSessionId);
                        const vodOperationId = databaseService.createOperationId(
                            'db-save-content'
                        );
                        registerImportOperation(vodOperationId);
                        const vod = (await dataSource.getContent(
                            ctx.playlistId,
                            ctx.credentials,
                            'movie',
                            onProgress,
                            onTotal,
                            {
                                operationId: vodOperationId,
                                sessionId: options?.sessionId,
                                onEvent: trackImportEvent,
                                onPhaseChange: (phase) =>
                                    patchState(store, {
                                        isImporting: true,
                                        importPhase: phase,
                                    }),
                            }
                        )) as XtreamVodStream[];
                        throwIfImportCancelled(options?.importSessionId);
                        await setImportStatus(ctx.playlistId, 'vod', 'completed');
                        options?.completedTypes?.add('vod');
                        patchState(store, {
                            vodStreams: vod,
                        });
                        updateContentTypeLoadState('vod', 'ready');

                        throwIfImportCancelled(options?.importSessionId);
                        const seriesOperationId =
                            databaseService.createOperationId(
                                'db-save-content'
                            );
                        registerImportOperation(seriesOperationId);
                        const series = (await dataSource.getContent(
                            ctx.playlistId,
                            ctx.credentials,
                            'series',
                            onProgress,
                            onTotal,
                            {
                                operationId: seriesOperationId,
                                sessionId: options?.sessionId,
                                onEvent: trackImportEvent,
                                onPhaseChange: (phase) =>
                                    patchState(store, {
                                        isImporting: true,
                                        importPhase: phase,
                                    }),
                            }
                        )) as XtreamSerieItem[];
                        throwIfImportCancelled(options?.importSessionId);
                        await setImportStatus(ctx.playlistId, 'series', 'completed');
                        options?.completedTypes?.add('series');
                        patchState(store, {
                            serialStreams: series,
                            isLoadingContent: false,
                        });
                        updateContentTypeLoadState('series', 'ready');
                    } catch (error) {
                        if (!isDbAbortError(error)) {
                            logger.error('Error fetching content', error);
                        }
                        patchState(store, { isLoadingContent: false });
                        throw error;
                    }
                },

                /**
                 * Initialize content (fetch categories and content)
                 */
                async initializeContent(): Promise<void> {
                    await runContentInitialization();
                },

                async hasUsableOfflineCache(): Promise<boolean> {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) {
                        return false;
                    }

                    return hasCompletedOfflineCache(ctx.playlistId);
                },

                async retryContentInitialization(): Promise<void> {
                    const portalStatus =
                        (await getPortalStore().checkPortalStatus?.()) ??
                        getPortalStore().portalStatus?.() ??
                        'unavailable';
                    const blockReason = resolveInitBlockReason(portalStatus);

                    if (blockReason) {
                        patchState(store, {
                            contentInitBlockReason: blockReason,
                        });
                        return;
                    }

                    patchState(store, {
                        contentInitBlockReason: null,
                        isContentInitialized: false,
                    });
                    const ctx = getCredentialsFromStore();
                    if (ctx) {
                        clearCancelledPlaylistInitializationLock(
                            ctx.playlistId
                        );
                    }

                    await runContentInitialization(true);
                },

                async cancelImport(): Promise<void> {
                    const activeImportSessionId = store.activeImportSessionId();
                    const activeImportOperationIds =
                        store.activeImportOperationIds();

                    if (!activeImportSessionId || store.isCancellingImport()) {
                        return;
                    }

                    patchState(store, {
                        isCancellingImport: true,
                        contentInitBlockReason: 'cancelled',
                        activeImportSessionId: null,
                    });
                    const ctx = getCredentialsFromStore();
                    if (ctx) {
                        setCancelledPlaylistInitializationLock(
                            ctx.playlistId
                        );
                    }

                    await xtreamApiService.cancelSession(activeImportSessionId);

                    await Promise.all(
                        activeImportOperationIds.map((operationId) =>
                            databaseService.cancelOperation(operationId)
                        )
                    );
                },

                /**
                 * Reload categories from database (after visibility changes)
                 */
                async reloadCategories(): Promise<void> {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) return;

                    try {
                        const [live, vod, series] = await Promise.all([
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'live'
                            ),
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'vod'
                            ),
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'series'
                            ),
                        ]);

                        patchState(store, {
                            liveCategories: live,
                            vodCategories: vod,
                            serialCategories: series,
                        });
                    } catch (error) {
                        logger.error('Error reloading categories', error);
                    }
                },

                /**
                 * Update import progress
                 */
                setImportProgress(count: number, total?: number): void {
                    const updates: Partial<ContentState> = {
                        importCount: count,
                    };
                    if (total !== undefined) {
                        updates.itemsToImport = total;
                    }
                    patchState(store, updates);
                },

                /**
                 * Reset content state
                 */
                resetContent(): void {
                    patchState(store, initialContentState);
                },
            };

            return methods;
        })
    );
}
