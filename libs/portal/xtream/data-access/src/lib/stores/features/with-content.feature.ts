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
} from '@iptvnator/shared/interfaces';
import {
    measureRendererPerformancePhase,
    RENDERER_PERFORMANCE_PHASE,
} from '@iptvnator/shared/logging';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    DataService,
    DatabaseService,
    DbOperationEvent,
    isDbAbortError,
    resetHostConnectivityGuard,
    XtreamPendingRestoreService,
    XtreamImportStatus,
} from '@iptvnator/services';
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
    XtreamCachedContentScope,
    XtreamContentInitBlockReason,
    XtreamContentLoadState,
    XtreamContentLoadStateByType,
} from '../../xtream-state';

const cancelledPlaylistInitializationLockKey = (playlistId: string): string =>
    `xtream-init-cancelled:${playlistId}`;

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

const setCancelledPlaylistInitializationLock = (playlistId: string): void => {
    try {
        localStorage.setItem(
            cancelledPlaylistInitializationLockKey(playlistId),
            'true'
        );
    } catch {
        // Ignore storage write failures; runtime state still carries the block.
    }
};

const clearCancelledPlaylistInitializationLock = (playlistId: string): void => {
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
    vodCategoriesPlaylistId: string | null;
    serialCategories: (XtreamCategory | XtreamCategoryFromDb)[];
    liveStreams: XtreamLiveStream[];
    vodStreams: XtreamVodStream[];
    vodStreamsPlaylistId: string | null;
    serialStreams: XtreamSerieItem[];
    isLoadingCategories: boolean;
    isLoadingContent: boolean;
    isImporting: boolean;
    contentLoadStateByType: XtreamContentLoadStateByType;
    isCancellingImport: boolean;
    importCount: number;
    importPhase: string | null;
    itemsToImport: number;
    activeImportContentType: ContentType | null;
    activeImportCurrentCount: number;
    activeImportTotalCount: number;
    activeImportSessionId: string | null;
    activeImportOperationIds: string[];
    isContentInitialized: boolean;
    isPendingRestoreBlocked: boolean;
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
    vodCategoriesPlaylistId: null,
    serialCategories: [],
    liveStreams: [],
    vodStreams: [],
    vodStreamsPlaylistId: null,
    serialStreams: [],
    isLoadingCategories: false,
    isLoadingContent: false,
    isImporting: false,
    contentLoadStateByType: { ...initialContentLoadStateByType },
    isCancellingImport: false,
    importCount: 0,
    importPhase: null,
    itemsToImport: 0,
    activeImportContentType: null,
    activeImportCurrentCount: 0,
    activeImportTotalCount: 0,
    activeImportSessionId: null,
    activeImportOperationIds: [],
    isContentInitialized: false,
    isPendingRestoreBlocked: false,
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
        currentPlaylist?: () => (XtreamCredentials & { id?: string }) | null;
        playlistId?: () => string | null;
        portalStatus?: () => PortalStatusType;
        checkPortalStatus?: () => Promise<PortalStatusType>;
        selectedContentType?: () => ContentType | undefined;
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
            const dataService = inject(DataService);
            const databaseService = inject(DatabaseService);
            const pendingRestoreService = inject(XtreamPendingRestoreService);
            const xtreamApiService = inject(XtreamApiService);
            const importTypes: ContentType[] = ['live', 'vod', 'series'];
            let activeInitializationPromise: Promise<void> | null = null;
            // Types that actually contacted the provider (or saved remote
            // data) in the current initialization. Cancellation cleanup must
            // only clear these: a type served entirely from the local cache
            // has nothing partial to clean up, and clearing it would throw
            // away a healthy catalog and force a full redownload.
            const sessionRemoteWorkTypes = new Set<ContentType>();
            let cachedHydrationGeneration = 0;
            const activeCachedHydrationPromises = new Map<
                string,
                Promise<void>
            >();

            const getCachedHydrationKey = (
                playlistId: string,
                scope?: XtreamCachedContentScope | null
            ): string => `${playlistId}:${scope ?? 'all'}`;

            const toDbCategoryType = (type: ContentType): DbCategoryType => {
                switch (type) {
                    case 'live':
                        return 'live';
                    case 'vod':
                        return 'movies';
                    case 'series':
                        return 'series';
                }
            };

            const toCategoryType = (
                type: ContentType
            ): 'live' | 'vod' | 'series' => type;

            const toStreamType = (
                type: ContentType
            ): 'live' | 'movie' | 'series' => {
                return type === 'vod' ? 'movie' : type;
            };

            const getTypesForCacheScope = (
                scope?: XtreamCachedContentScope | null
            ): ContentType[] => {
                switch (scope) {
                    case 'live':
                    case 'vod':
                    case 'series':
                        return [scope];
                    case 'search':
                    case 'recently-added':
                    default:
                        return importTypes;
                }
            };

            const asCachedContent = <T>(content: unknown): T[] =>
                content as T[];

            const hasPendingRestoreOrReadFailure = (
                playlistId: string
            ): boolean => {
                try {
                    return (
                        pendingRestoreService.getOrThrow(playlistId) !== null
                    );
                } catch {
                    return true;
                }
            };

            const markContentScopeLoading = (
                scope?: XtreamCachedContentScope | null,
                options?: { preserveInitialized?: boolean }
            ): void => {
                const types = getTypesForCacheScope(scope);

                patchState(store, (state) => {
                    const nextLoadStates = {
                        ...state.contentLoadStateByType,
                    };

                    for (const type of types) {
                        nextLoadStates[type] = 'loading';
                    }

                    return {
                        isLoadingCategories: true,
                        isLoadingContent: true,
                        isImporting: false,
                        isContentInitialized: options?.preserveInitialized
                            ? state.isContentInitialized
                            : false,
                        contentInitBlockReason: null,
                        contentLoadStateByType: nextLoadStates,
                    };
                });
            };

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

            const setActiveImportProgress = (
                type: ContentType | null,
                current = 0,
                total = 0
            ): void => {
                patchState(store, {
                    activeImportContentType: type,
                    activeImportCurrentCount: current,
                    activeImportTotalCount: total,
                });
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
                        store.activeImportSessionId() !==
                            expectedImportSessionId)
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
                        allowedOutputFormats: playlist.allowedOutputFormats,
                        serverUrl: playlist.serverUrl,
                        username: playlist.username,
                        password: playlist.password,
                    },
                };
            };

            const hasCachedContentForType = async (
                playlistId: string,
                type: ContentType
            ): Promise<boolean> => {
                const [hasCategories, hasContent] = await Promise.all([
                    dataSource.hasCategories(
                        playlistId,
                        toDbCategoryType(type)
                    ),
                    dataSource.hasContent(playlistId, toStreamType(type)),
                ]);

                return hasCategories && hasContent;
            };

            const hasCachedContentForScope = async (
                playlistId: string,
                scope?: XtreamCachedContentScope | null
            ): Promise<boolean> => {
                if (hasPendingRestoreOrReadFailure(playlistId)) {
                    return false;
                }

                const types = getTypesForCacheScope(scope);

                if (
                    scope === 'search' ||
                    scope === 'recently-added' ||
                    !scope
                ) {
                    const checks = await Promise.all(
                        types.map((type) =>
                            dataSource.hasContent(
                                playlistId,
                                toStreamType(type)
                            )
                        )
                    );
                    return (
                        checks.some(Boolean) &&
                        !hasPendingRestoreOrReadFailure(playlistId)
                    );
                }

                return (
                    (await hasCachedContentForType(playlistId, scope)) &&
                    !hasPendingRestoreOrReadFailure(playlistId)
                );
            };

            const isCurrentCachedHydrationContext = (
                playlistId: string,
                generation: number
            ): boolean => {
                if (cachedHydrationGeneration !== generation) {
                    return false;
                }

                const storeAny = getPortalStore();
                const currentPlaylist = storeAny.currentPlaylist?.();
                const currentPlaylistId = storeAny.playlistId?.();

                return (
                    currentPlaylistId === playlistId &&
                    (!currentPlaylist?.id || currentPlaylist.id === playlistId)
                );
            };

            const isCachedContentScopeReady = (
                scope?: XtreamCachedContentScope | null
            ): boolean => {
                const types = getTypesForCacheScope(scope);
                const loadStates = store.contentLoadStateByType();
                return types.every((type) => loadStates[type] === 'ready');
            };

            const blockCacheForPendingRestore = (
                playlistId: string,
                scope?: XtreamCachedContentScope | null
            ): boolean => {
                if (!hasPendingRestoreOrReadFailure(playlistId)) {
                    return false;
                }

                patchState(store, (state) => {
                    const nextLoadStates = {
                        ...state.contentLoadStateByType,
                    };
                    for (const type of getTypesForCacheScope(scope)) {
                        nextLoadStates[type] = 'error';
                    }

                    return {
                        isLoadingCategories: false,
                        isLoadingContent: false,
                        isContentInitialized: false,
                        isPendingRestoreBlocked: true,
                        contentInitBlockReason:
                            state.contentInitBlockReason ?? 'error',
                        contentLoadStateByType: nextLoadStates,
                    };
                });
                return true;
            };

            const executeCachedContentHydration = async (
                playlistId: string,
                scope: XtreamCachedContentScope | null | undefined,
                generation: number
            ): Promise<void> => {
                const types = getTypesForCacheScope(scope);
                markContentScopeLoading(scope, {
                    preserveInitialized: store.isContentInitialized(),
                });

                let cachedEntries: Array<{
                    type: ContentType;
                    categories: Awaited<
                        ReturnType<typeof dataSource.getCachedCategories>
                    >;
                    content: Awaited<
                        ReturnType<typeof dataSource.getCachedContent>
                    >;
                }>;

                try {
                    cachedEntries = await Promise.all(
                        types.map(async (type) => {
                            const [categories, content] = await Promise.all([
                                dataSource.getCachedCategories(
                                    playlistId,
                                    toCategoryType(type)
                                ),
                                dataSource.getCachedContent(
                                    playlistId,
                                    toStreamType(type)
                                ),
                            ]);

                            return { type, categories, content };
                        })
                    );
                } catch (error) {
                    if (
                        !isCurrentCachedHydrationContext(playlistId, generation)
                    ) {
                        return;
                    }

                    const errorBlockReason: XtreamContentInitBlockReason =
                        'error';
                    patchState(store, (state) => {
                        const nextLoadStates = {
                            ...state.contentLoadStateByType,
                        };

                        for (const type of types) {
                            nextLoadStates[type] = 'error';
                        }

                        return {
                            isLoadingCategories: false,
                            isLoadingContent: false,
                            contentInitBlockReason: errorBlockReason,
                            contentLoadStateByType: nextLoadStates,
                        };
                    });
                    throw error;
                }

                if (!isCurrentCachedHydrationContext(playlistId, generation)) {
                    return;
                }

                if (blockCacheForPendingRestore(playlistId, scope)) {
                    return;
                }

                patchState(store, (state) => {
                    const nextLoadStates = {
                        ...state.contentLoadStateByType,
                    };
                    const updates: Partial<ContentState> = {
                        isLoadingCategories: false,
                        isLoadingContent: false,
                        isImporting: false,
                        isContentInitialized: true,
                        isPendingRestoreBlocked: false,
                        contentInitBlockReason: null,
                    };

                    for (const entry of cachedEntries) {
                        nextLoadStates[entry.type] = 'ready';

                        switch (entry.type) {
                            case 'live':
                                updates.liveCategories = entry.categories;
                                updates.liveStreams =
                                    asCachedContent<XtreamLiveStream>(
                                        entry.content
                                    );
                                break;
                            case 'vod':
                                updates.vodCategories = entry.categories;
                                updates.vodCategoriesPlaylistId = playlistId;
                                updates.vodStreams =
                                    asCachedContent<XtreamVodStream>(
                                        entry.content
                                    );
                                updates.vodStreamsPlaylistId = playlistId;
                                break;
                            case 'series':
                                updates.serialCategories = entry.categories;
                                updates.serialStreams =
                                    asCachedContent<XtreamSerieItem>(
                                        entry.content
                                    );
                                break;
                        }
                    }

                    updates.contentLoadStateByType = nextLoadStates;
                    return updates;
                });
            };

            const hydrateCachedContentForScope = async (
                scope?: XtreamCachedContentScope | null
            ): Promise<void> => {
                const ctx = getCredentialsFromStore();
                if (!ctx) return;

                if (blockCacheForPendingRestore(ctx.playlistId, scope)) {
                    return;
                }

                if (isCachedContentScopeReady(scope)) {
                    patchState(store, {
                        isLoadingCategories: false,
                        isLoadingContent: false,
                        isContentInitialized: true,
                        isPendingRestoreBlocked: false,
                        contentInitBlockReason: null,
                    });
                    return;
                }

                const requestKey = getCachedHydrationKey(ctx.playlistId, scope);
                const inFlightRequest =
                    activeCachedHydrationPromises.get(requestKey);

                if (inFlightRequest) {
                    return inFlightRequest;
                }

                const generation = cachedHydrationGeneration;
                const request = executeCachedContentHydration(
                    ctx.playlistId,
                    scope,
                    generation
                ).finally(() => {
                    if (
                        activeCachedHydrationPromises.get(requestKey) ===
                        request
                    ) {
                        activeCachedHydrationPromises.delete(requestKey);
                    }
                });

                activeCachedHydrationPromises.set(requestKey, request);
                return request;
            };

            const publishImportPhase = (phase: string): void => {
                patchState(store, (state) => ({
                    // 'loading-cached' is a read-only presentation phase. It
                    // must not mark a real import as started: the error path
                    // gates cache cleanup on isImporting, so flagging a warm
                    // DB read would let a cancellation wipe the healthy
                    // cached catalog and force a full provider redownload.
                    isImporting:
                        state.isImporting || phase !== 'loading-cached',
                    importPhase: phase,
                }));
            };

            const publishTypedImportPhase =
                (type: ContentType) =>
                (phase: string): void => {
                    if (phase !== 'loading-cached') {
                        sessionRemoteWorkTypes.add(type);
                    }
                    publishImportPhase(phase);
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

                if (event.status === 'started' || event.status === 'progress') {
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

                if (
                    event.operation === 'save-content' &&
                    store.activeImportContentType()
                ) {
                    // A save event proves this type is writing remote data,
                    // independent of the loading phase that preceded it.
                    const activeType = store.activeImportContentType();
                    if (activeType) {
                        sessionRemoteWorkTypes.add(activeType);
                    }
                    patchState(store, (state) => ({
                        activeImportCurrentCount:
                            event.current ?? state.activeImportCurrentCount,
                        activeImportTotalCount:
                            event.total ?? state.activeImportTotalCount,
                    }));
                }
            };

            const registerImportOperation = (operationId: string): void => {
                patchState(store, (state) => ({
                    activeImportOperationIds:
                        state.activeImportOperationIds.includes(operationId)
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

                    // Only types that performed remote/save work this session
                    // can hold partial data. A type still pending because it
                    // was being read from the local cache keeps its healthy
                    // catalog instead of being cleared into a redownload.
                    if (!sessionRemoteWorkTypes.has(type)) {
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

                sessionRemoteWorkTypes.clear();
                patchState(store, {
                    isImporting: false,
                    isCancellingImport: false,
                    importCount: 0,
                    importPhase: null,
                    itemsToImport: 0,
                    activeImportContentType: null,
                    activeImportCurrentCount: 0,
                    activeImportTotalCount: 0,
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
                    // Capture parked state before publishing any imported
                    // content. A retry may load each type from the DB without
                    // emitting an import phase, so the store-owned gate is what
                    // prevents source-pin edits until replay is consumed.
                    const initialRestoreSnapshot =
                        pendingRestoreService.getSnapshotOrThrow(
                            ctx.playlistId
                        );
                    patchState(store, {
                        isPendingRestoreBlocked:
                            initialRestoreSnapshot !== null,
                    });

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

                    // Only the revision captured before import belongs to this
                    // content generation. A newer revision may come from a
                    // refresh that has deleted the catalog and must remain
                    // parked until its own replacement import completes.
                    const currentRestoreSnapshot =
                        pendingRestoreService.getSnapshotOrThrow(
                            ctx.playlistId
                        );
                    patchState(store, {
                        isPendingRestoreBlocked:
                            currentRestoreSnapshot !== null,
                    });

                    // Restore user data if needed
                    if (initialRestoreSnapshot) {
                        try {
                            throwIfImportCancelled(importSessionId);
                            const restoreOperationId =
                                databaseService.createOperationId(
                                    'xtream-restore'
                                );
                            registerImportOperation(restoreOperationId);
                            patchState(store, {
                                importPhase: 'restoring-favorites',
                            });
                            const restoreResult =
                                await pendingRestoreService.applyAndConsume(
                                    ctx.playlistId,
                                    initialRestoreSnapshot,
                                    async (pendingState) => {
                                        throwIfImportCancelled(importSessionId);
                                        await dataSource.restoreUserData(
                                            ctx.playlistId,
                                            pendingState,
                                            {
                                                onEvent: trackImportEvent,
                                                operationId: restoreOperationId,
                                            }
                                        );
                                        throwIfImportCancelled(importSessionId);
                                    }
                                );
                            if (restoreResult === 'consume-failed') {
                                throw new Error(
                                    `Clearing pending restore state for "${ctx.playlistId}" failed.`
                                );
                            }
                        } catch (err) {
                            throwIfImportCancelled(importSessionId);

                            if (!isDbAbortError(err)) {
                                logger.error('Error restoring user data', err);
                            }

                            throw err;
                        }
                    }

                    const isRestoreStillPending =
                        hasPendingRestoreOrReadFailure(ctx.playlistId);
                    patchState(store, {
                        isPendingRestoreBlocked: isRestoreStillPending,
                    });
                    if (isRestoreStillPending) {
                        return;
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
                    measureRendererPerformancePhase(
                        RENDERER_PERFORMANCE_PHASE.XTREAM_IMPORT_TERMINAL,
                        () =>
                            patchState(store, {
                                isImporting: false,
                                isCancellingImport: false,
                                importCount: 0,
                                importPhase: null,
                                itemsToImport: 0,
                                activeImportContentType: null,
                                activeImportCurrentCount: 0,
                                activeImportTotalCount: 0,
                                activeImportSessionId: null,
                                activeImportOperationIds: [],
                            }),
                        () => ({
                            items:
                                store.liveStreams().length +
                                store.vodStreams().length +
                                store.serialStreams().length,
                        })
                    );
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
                async fetchAllCategories(options?: {
                    sessionId?: string;
                }): Promise<void> {
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
                                    onPhaseChange:
                                        publishTypedImportPhase('live'),
                                }
                            ),
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'vod',
                                {
                                    sessionId: options?.sessionId,
                                    onPhaseChange:
                                        publishTypedImportPhase('vod'),
                                }
                            ),
                            dataSource.getCategories(
                                ctx.playlistId,
                                ctx.credentials,
                                'series',
                                {
                                    sessionId: options?.sessionId,
                                    onPhaseChange:
                                        publishTypedImportPhase('series'),
                                }
                            ),
                        ]);

                        // This span ends after synchronous store publication;
                        // the renderer probe owns paint observation.
                        measureRendererPerformancePhase(
                            RENDERER_PERFORMANCE_PHASE.XTREAM_PUBLISH_CATEGORIES,
                            () =>
                                patchState(store, {
                                    liveCategories: live,
                                    vodCategories: vod,
                                    vodCategoriesPlaylistId: ctx.playlistId,
                                    serialCategories: series,
                                    isLoadingCategories: false,
                                }),
                            () => ({
                                items: live.length + vod.length + series.length,
                            })
                        );
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
                async fetchAllContent(options?: {
                    importSessionId?: string;
                    sessionId?: string;
                    completedTypes?: Set<ContentType>;
                }): Promise<void> {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) return;

                    patchState(store, { isLoadingContent: true });

                    // Track combined progress across all content types
                    let totalItems = 0;
                    let importedItems = 0;

                    const onTotal = (count: number) => {
                        totalItems += count;
                        patchState(store, {
                            itemsToImport: totalItems,
                            activeImportTotalCount: count,
                        });
                    };

                    const onProgress = (count: number) => {
                        importedItems += count;
                        patchState(store, (state) => ({
                            importCount: importedItems,
                            activeImportCurrentCount:
                                state.activeImportCurrentCount + count,
                        }));
                    };

                    try {
                        throwIfImportCancelled(options?.importSessionId);
                        setActiveImportProgress('live');
                        const liveOperationId =
                            databaseService.createOperationId(
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
                                onPhaseChange: publishTypedImportPhase('live'),
                            }
                        )) as XtreamLiveStream[];
                        throwIfImportCancelled(options?.importSessionId);
                        await setImportStatus(
                            ctx.playlistId,
                            'live',
                            'completed'
                        );
                        options?.completedTypes?.add('live');
                        measureRendererPerformancePhase(
                            RENDERER_PERFORMANCE_PHASE.XTREAM_PUBLISH_LIVE,
                            () =>
                                patchState(store, {
                                    liveStreams: live,
                                }),
                            () => ({ items: live.length })
                        );
                        updateContentTypeLoadState('live', 'ready');

                        throwIfImportCancelled(options?.importSessionId);
                        setActiveImportProgress('vod');
                        const vodOperationId =
                            databaseService.createOperationId(
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
                                onPhaseChange: publishTypedImportPhase('vod'),
                            }
                        )) as XtreamVodStream[];
                        throwIfImportCancelled(options?.importSessionId);
                        await setImportStatus(
                            ctx.playlistId,
                            'vod',
                            'completed'
                        );
                        options?.completedTypes?.add('vod');
                        measureRendererPerformancePhase(
                            RENDERER_PERFORMANCE_PHASE.XTREAM_PUBLISH_VOD,
                            () =>
                                patchState(store, {
                                    vodStreams: vod,
                                    vodStreamsPlaylistId: ctx.playlistId,
                                }),
                            () => ({ items: vod.length })
                        );
                        updateContentTypeLoadState('vod', 'ready');

                        throwIfImportCancelled(options?.importSessionId);
                        setActiveImportProgress('series');
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
                                onPhaseChange:
                                    publishTypedImportPhase('series'),
                            }
                        )) as XtreamSerieItem[];
                        throwIfImportCancelled(options?.importSessionId);
                        await setImportStatus(
                            ctx.playlistId,
                            'series',
                            'completed'
                        );
                        options?.completedTypes?.add('series');
                        measureRendererPerformancePhase(
                            RENDERER_PERFORMANCE_PHASE.XTREAM_PUBLISH_SERIES,
                            () =>
                                patchState(store, {
                                    serialStreams: series,
                                    isLoadingContent: false,
                                }),
                            () => ({ items: series.length })
                        );
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

                reconcilePendingRestoreBlock(): boolean {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) {
                        return false;
                    }

                    const isBlocked = hasPendingRestoreOrReadFailure(
                        ctx.playlistId
                    );
                    patchState(store, (state) => ({
                        isPendingRestoreBlocked: isBlocked,
                        contentInitBlockReason:
                            isBlocked && !state.activeImportSessionId
                                ? (state.contentInitBlockReason ?? 'error')
                                : state.contentInitBlockReason,
                    }));
                    return isBlocked;
                },

                async hasUsableOfflineCache(
                    scope?: XtreamCachedContentScope | null
                ): Promise<boolean> {
                    const ctx = getCredentialsFromStore();
                    if (!ctx) {
                        return false;
                    }

                    return hasCachedContentForScope(ctx.playlistId, scope);
                },

                prepareContentLoading(
                    scope?: XtreamCachedContentScope | null
                ): void {
                    markContentScopeLoading(scope);
                },

                isCachedContentScopeReady(
                    scope?: XtreamCachedContentScope | null
                ): boolean {
                    const ctx = getCredentialsFromStore();
                    return (
                        (!ctx ||
                            !hasPendingRestoreOrReadFailure(ctx.playlistId)) &&
                        isCachedContentScopeReady(scope)
                    );
                },

                async hydrateCachedContent(
                    scope?: XtreamCachedContentScope | null
                ): Promise<void> {
                    await hydrateCachedContentForScope(scope);
                },

                async retryContentInitialization(): Promise<void> {
                    // FIRST, before the status check below: that check is the
                    // one request a tripped connectivity guard would fast-fail,
                    // and its 'unavailable' verdict returns early — so a reset
                    // placed any later would never run and this button would
                    // silently do nothing for the guard's whole window.
                    await resetHostConnectivityGuard(
                        dataService,
                        getCredentialsFromStore()?.credentials.serverUrl
                    );

                    const portalStatus =
                        (await getPortalStore().checkPortalStatus?.()) ??
                        getPortalStore().portalStatus?.() ??
                        'unavailable';
                    const blockReason = resolveInitBlockReason(portalStatus);
                    const ctx = getCredentialsFromStore();
                    const cacheScope =
                        getPortalStore().selectedContentType?.() ?? null;

                    if (blockReason) {
                        if (
                            ctx &&
                            (await hasCachedContentForScope(
                                ctx.playlistId,
                                cacheScope
                            ))
                        ) {
                            clearCancelledPlaylistInitializationLock(
                                ctx.playlistId
                            );
                            await hydrateCachedContentForScope(cacheScope);
                            return;
                        }

                        patchState(store, {
                            contentInitBlockReason: blockReason,
                        });
                        return;
                    }

                    patchState(store, {
                        contentInitBlockReason: null,
                        isContentInitialized: false,
                    });
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
                        activeImportContentType: null,
                        activeImportCurrentCount: 0,
                        activeImportTotalCount: 0,
                        activeImportSessionId: null,
                    });
                    const ctx = getCredentialsFromStore();
                    if (ctx) {
                        setCancelledPlaylistInitializationLock(ctx.playlistId);
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
                            vodCategoriesPlaylistId: ctx.playlistId,
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
                    cachedHydrationGeneration += 1;
                    activeCachedHydrationPromises.clear();
                    patchState(store, initialContentState);
                },
            };

            return methods;
        })
    );
}
