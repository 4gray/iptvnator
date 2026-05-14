import { computed, inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import {
    ImdbMovieRatingMatch,
    ImdbMovieRatingRequestItem,
    MediaStreamMetadata,
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from 'shared-interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    DatabaseService,
    DbOperationEvent,
    ImdbRatingsService,
    isDbAbortError,
    XtreamPendingRestoreService,
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
    activeImportContentType: ContentType | null;
    activeImportCurrentCount: number;
    activeImportTotalCount: number;
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
    activeImportContentType: null,
    activeImportCurrentCount: 0,
    activeImportTotalCount: 0,
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
            id?: string;
            password: string;
            serverUrl: string;
            username: string;
        } | null;
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
            const databaseService = inject(DatabaseService);
            const pendingRestoreService = inject(XtreamPendingRestoreService);
            const xtreamApiService = inject(XtreamApiService);
            const imdbRatingsService = inject(ImdbRatingsService);
            const importTypes: ContentType[] = ['live', 'vod', 'series'];
            let activeInitializationPromise: Promise<void> | null = null;
            let cachedHydrationGeneration = 0;
            let imdbRatingHydrationGeneration = {
                vod: 0,
                series: 0,
            };
            const activeCachedHydrationPromises = new Map<
                string,
                Promise<void>
            >();
            type ImdbHydrationKind = 'movie' | 'series';
            type ImdbHydrationGenerationKey = 'vod' | 'series';
            type ImdbHydratableStream = (XtreamVodStream | XtreamSerieItem) & {
                id?: string | number;
                imdbId?: string;
                imdb_id?: string;
                imdbRating?: string | number;
                imdbVotes?: number;
                imdbMatchedTitle?: string;
                imdbMatchedYear?: number;
                imdbMatchConfidence?: number;
                imdbMatchReason?: string;
                info?:
                    | {
                          duration?: string | number;
                          episode_run_time?: string | number;
                          name?: string;
                          o_name?: string;
                          rating_imdb?: string | number;
                          releaseDate?: string;
                          releasedate?: string;
                          title?: string;
                      }
                    | []
                    | null;
                movie_data?: {
                    name?: string;
                    title?: string;
                };
                original_name?: string;
                o_name?: string;
                rating_imdb?: string | number;
                releaseDate?: string;
                releasedate?: string;
                series_id?: string | number;
                stream_id?: string | number;
                title?: string;
                xtream_id?: string | number;
                year?: string | number;
            };

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

            const asString = (value: unknown): string | undefined =>
                typeof value === 'string' && value.trim()
                    ? value.trim()
                    : undefined;

            const parseImdbRating = (value: unknown): number | undefined => {
                if (typeof value === 'number') {
                    return Number.isFinite(value) ? value : undefined;
                }

                if (typeof value !== 'string') {
                    return undefined;
                }

                const match = value
                    .trim()
                    .replace(',', '.')
                    .match(/\d+(\.\d+)?/);
                if (!match) {
                    return undefined;
                }

                const rating = Number.parseFloat(match[0]);
                return Number.isFinite(rating) ? rating : undefined;
            };

            const getContentStreamKey = (
                stream: ImdbHydratableStream
            ): string => {
                return String(
                    stream.stream_id ??
                        stream.series_id ??
                        stream.xtream_id ??
                        stream.id ??
                        stream.title ??
                        stream.o_name ??
                        stream.name ??
                        ''
                );
            };

            const getProviderImdbRating = (
                stream: ImdbHydratableStream
            ): number | undefined => {
                const info =
                    stream.info && !Array.isArray(stream.info)
                        ? stream.info
                        : null;

                return (
                    parseImdbRating(stream.rating_imdb) ??
                    parseImdbRating(info?.rating_imdb)
                );
            };

            const applyProviderImdbRatingToStream = <
                T extends ImdbHydratableStream,
            >(
                stream: T
            ): T => {
                const providerRating = getProviderImdbRating(stream);
                if (providerRating === undefined) {
                    return stream;
                }

                return {
                    ...stream,
                    imdbRating: providerRating,
                    imdbMatchReason: 'provider-rating_imdb',
                };
            };

            const extractYear = (value: unknown): number | undefined => {
                if (typeof value === 'number' && Number.isFinite(value)) {
                    return value;
                }

                if (typeof value !== 'string') {
                    return undefined;
                }

                const match = value.match(/\b(19\d{2}|20\d{2})\b/);
                return match ? Number.parseInt(match[1], 10) : undefined;
            };

            const parseDurationMinutes = (
                value: unknown
            ): number | undefined => {
                if (typeof value === 'number' && Number.isFinite(value)) {
                    return value;
                }

                if (typeof value !== 'string') {
                    return undefined;
                }

                const parts = value
                    .split(':')
                    .map((part) => Number.parseInt(part, 10));
                if (parts.length === 3 && parts.every(Number.isFinite)) {
                    return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
                }

                const numeric = Number.parseInt(value, 10);
                return Number.isFinite(numeric) ? numeric : undefined;
            };

            const createImdbRatingRequestItems = (
                streams: ImdbHydratableStream[],
                kind: ImdbHydrationKind
            ): ImdbMovieRatingRequestItem[] => {
                return streams
                    .map<ImdbMovieRatingRequestItem | null>((stream) => {
                        const imdbId = asString(
                            stream.imdb_id ?? stream.imdbId
                        );
                        const hasResolvedImdbRating =
                            Boolean(imdbId) &&
                            (getProviderImdbRating(stream) !== undefined ||
                                parseImdbRating(stream.imdbRating) !==
                                    undefined);

                        if (hasResolvedImdbRating) {
                            return null;
                        }

                        const title =
                            asString(stream.title) ??
                            asString(stream.name) ??
                            asString(stream.movie_data?.name) ??
                            asString(stream.movie_data?.title) ??
                            asString(
                                stream.info && !Array.isArray(stream.info)
                                    ? (stream.info.title ?? stream.info.name)
                                    : undefined
                            );
                        if (!title && !imdbId) {
                            return null;
                        }

                        const originalTitle =
                            asString(stream.o_name) ??
                            asString(stream.original_name) ??
                            asString(
                                stream.info && !Array.isArray(stream.info)
                                    ? stream.info.o_name
                                    : undefined
                            );
                        const year =
                            extractYear(stream.year) ??
                            extractYear(stream.releaseDate) ??
                            extractYear(stream.releasedate) ??
                            extractYear(
                                stream.info && !Array.isArray(stream.info)
                                    ? stream.info.releaseDate
                                    : undefined
                            ) ??
                            extractYear(
                                stream.info && !Array.isArray(stream.info)
                                    ? stream.info.releasedate
                                    : undefined
                            ) ??
                            extractYear(title) ??
                            extractYear(originalTitle);
                        const durationMinutes =
                            parseDurationMinutes(
                                (
                                    stream as ImdbHydratableStream & {
                                        duration?: string | number;
                                    }
                                ).duration
                            ) ??
                            parseDurationMinutes(
                                stream.info && !Array.isArray(stream.info)
                                    ? (stream.info.duration ??
                                          stream.info.episode_run_time)
                                    : undefined
                            ) ??
                            parseDurationMinutes(
                                (
                                    stream as ImdbHydratableStream & {
                                        episode_run_time?: string | number;
                                    }
                                ).episode_run_time
                            );

                        return {
                            id: getContentStreamKey(stream),
                            imdbId,
                            kind,
                            title,
                            originalTitle,
                            year,
                            durationMinutes,
                        };
                    })
                    .filter(
                        (item): item is ImdbMovieRatingRequestItem =>
                            item !== null
                    );
            };

            const applyImdbMatchToStream = <T extends ImdbHydratableStream>(
                stream: T,
                match: ImdbMovieRatingMatch
            ): T => {
                const providerRating = getProviderImdbRating(stream);

                return {
                    ...stream,
                    imdb_id: match.imdbId,
                    imdbRating: providerRating ?? match.rating,
                    imdbVotes: match.votes,
                    imdbMatchedTitle: match.title,
                    imdbMatchedYear: match.year,
                    imdbMatchConfidence: match.confidence,
                    imdbMatchReason:
                        providerRating === undefined
                            ? match.matchReason
                            : `${match.matchReason}+provider-rating_imdb`,
                };
            };

            const patchImdbHydratedStreams = <T extends ImdbHydratableStream>(
                kind: ImdbHydrationKind,
                hydrate: (stream: T) => T
            ): void => {
                patchState(store, (state) => {
                    if (kind === 'movie') {
                        return {
                            vodStreams: (state.vodStreams as T[]).map(
                                hydrate
                            ) as XtreamVodStream[],
                        };
                    }

                    return {
                        serialStreams: (state.serialStreams as T[]).map(
                            hydrate
                        ) as XtreamSerieItem[],
                    };
                });
            };

            const hydrateImdbRatingsForContentStreams = async <
                T extends ImdbHydratableStream,
            >(
                playlistId: string,
                streams: T[],
                kind: ImdbHydrationKind
            ): Promise<void> => {
                const generationKey: ImdbHydrationGenerationKey =
                    kind === 'movie' ? 'vod' : 'series';
                const providerRatedStreams = new Map(
                    streams
                        .map(
                            (stream) =>
                                [
                                    getContentStreamKey(stream),
                                    applyProviderImdbRatingToStream(stream),
                                ] as const
                        )
                        .filter(
                            ([, stream]) =>
                                parseImdbRating(stream.imdbRating) !== undefined
                        )
                );

                if (providerRatedStreams.size > 0) {
                    patchImdbHydratedStreams<T>(kind, (stream) => {
                        const providerRated = providerRatedStreams.get(
                            getContentStreamKey(stream)
                        );
                        return providerRated ?? stream;
                    });
                }

                const requestItems = createImdbRatingRequestItems(
                    streams,
                    kind
                );
                if (requestItems.length === 0) {
                    return;
                }

                const generation = ++imdbRatingHydrationGeneration[
                    generationKey
                ];

                try {
                    const response =
                        await imdbRatingsService.resolveMovieRatings(
                            requestItems
                        );

                    if (
                        generation !==
                            imdbRatingHydrationGeneration[generationKey] ||
                        getPortalStore().playlistId?.() !== playlistId
                    ) {
                        return;
                    }

                    if (response.status !== 'ready') {
                        logger.warn(
                            'IMDb rating resolution failed',
                            response.error
                        );
                        return;
                    }

                    patchImdbHydratedStreams<T>(kind, (stream) => {
                        const providerRating = getProviderImdbRating(stream);
                        const match =
                            response.matches[getContentStreamKey(stream)];
                        if (match) {
                            return applyImdbMatchToStream(stream, match);
                        }

                        if (providerRating !== undefined) {
                            return applyProviderImdbRatingToStream(stream);
                        }

                        return stream;
                    });
                } catch (error) {
                    logger.warn('Error resolving IMDb ratings', error);
                }
            };

            const hydrateImdbRatingsForVodStreams = async (
                playlistId: string,
                streams: XtreamVodStream[]
            ): Promise<void> =>
                hydrateImdbRatingsForContentStreams(
                    playlistId,
                    streams,
                    'movie'
                );

            const hydrateImdbRatingsForSeriesStreams = async (
                playlistId: string,
                streams: XtreamSerieItem[]
            ): Promise<void> =>
                hydrateImdbRatingsForContentStreams(
                    playlistId,
                    streams,
                    'series'
                );

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
                    return checks.some(Boolean);
                }

                return hasCachedContentForType(playlistId, scope);
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

                patchState(store, (state) => {
                    const nextLoadStates = {
                        ...state.contentLoadStateByType,
                    };
                    const updates: Partial<ContentState> = {
                        isLoadingCategories: false,
                        isLoadingContent: false,
                        isImporting: false,
                        isContentInitialized: true,
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
                                updates.vodStreams =
                                    asCachedContent<XtreamVodStream>(
                                        entry.content
                                    );
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

                const cachedVodEntry = cachedEntries.find(
                    (entry) => entry.type === 'vod'
                );
                if (cachedVodEntry) {
                    void hydrateImdbRatingsForVodStreams(
                        playlistId,
                        asCachedContent<XtreamVodStream>(cachedVodEntry.content)
                    );
                }

                const cachedSeriesEntry = cachedEntries.find(
                    (entry) => entry.type === 'series'
                );
                if (cachedSeriesEntry) {
                    void hydrateImdbRatingsForSeriesStreams(
                        playlistId,
                        asCachedContent<XtreamSerieItem>(
                            cachedSeriesEntry.content
                        )
                    );
                }
            };

            const hydrateCachedContentForScope = async (
                scope?: XtreamCachedContentScope | null
            ): Promise<void> => {
                const ctx = getCredentialsFromStore();
                if (!ctx) return;

                if (isCachedContentScopeReady(scope)) {
                    patchState(store, {
                        isLoadingCategories: false,
                        isLoadingContent: false,
                        isContentInitialized: true,
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
                    const restoreData = pendingRestoreService.get(
                        ctx.playlistId
                    );
                    if (restoreData) {
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
                            await dataSource.restoreUserData(
                                ctx.playlistId,
                                restoreData,
                                {
                                    onEvent: trackImportEvent,
                                    operationId: restoreOperationId,
                                }
                            );
                            throwIfImportCancelled(importSessionId);
                            pendingRestoreService.clear(ctx.playlistId);
                        } catch (err) {
                            if (!isDbAbortError(err)) {
                                logger.error('Error restoring user data', err);
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
                        activeImportContentType: null,
                        activeImportCurrentCount: 0,
                        activeImportTotalCount: 0,
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
                                onPhaseChange: (phase) =>
                                    patchState(store, {
                                        isImporting: true,
                                        importPhase: phase,
                                    }),
                            }
                        )) as XtreamLiveStream[];
                        throwIfImportCancelled(options?.importSessionId);
                        await setImportStatus(
                            ctx.playlistId,
                            'live',
                            'completed'
                        );
                        options?.completedTypes?.add('live');
                        patchState(store, {
                            liveStreams: live,
                        });
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
                                onPhaseChange: (phase) =>
                                    patchState(store, {
                                        isImporting: true,
                                        importPhase: phase,
                                    }),
                            }
                        )) as XtreamVodStream[];
                        throwIfImportCancelled(options?.importSessionId);
                        await setImportStatus(
                            ctx.playlistId,
                            'vod',
                            'completed'
                        );
                        options?.completedTypes?.add('vod');
                        patchState(store, {
                            vodStreams: vod,
                        });
                        updateContentTypeLoadState('vod', 'ready');
                        void hydrateImdbRatingsForVodStreams(
                            ctx.playlistId,
                            vod
                        );

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
                                onPhaseChange: (phase) =>
                                    patchState(store, {
                                        isImporting: true,
                                        importPhase: phase,
                                    }),
                            }
                        )) as XtreamSerieItem[];
                        throwIfImportCancelled(options?.importSessionId);
                        await setImportStatus(
                            ctx.playlistId,
                            'series',
                            'completed'
                        );
                        options?.completedTypes?.add('series');
                        patchState(store, {
                            serialStreams: series,
                            isLoadingContent: false,
                        });
                        updateContentTypeLoadState('series', 'ready');
                        void hydrateImdbRatingsForSeriesStreams(
                            ctx.playlistId,
                            series
                        );
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
                    return isCachedContentScopeReady(scope);
                },

                async hydrateCachedContent(
                    scope?: XtreamCachedContentScope | null
                ): Promise<void> {
                    await hydrateCachedContentForScope(scope);
                },

                async retryContentInitialization(): Promise<void> {
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

                setContentMediaMetadata(params: {
                    contentType: ContentType | 'movie';
                    xtreamId: string | number;
                    metadata: MediaStreamMetadata | null;
                }): void {
                    const metadata = params.metadata;
                    const contentType =
                        params.contentType === 'movie'
                            ? 'vod'
                            : params.contentType;
                    const targetId = Number(params.xtreamId);
                    if (
                        !metadata ||
                        !Number.isFinite(targetId) ||
                        targetId <= 0
                    ) {
                        return;
                    }

                    const patchItem = <
                        T extends {
                            audioLanguages?: string[];
                            id?: string | number;
                            mediaMetadata?: MediaStreamMetadata;
                            series_id?: string | number;
                            stream_id?: string | number;
                            subtitleLanguages?: string[];
                            xtream_id?: string | number;
                        },
                    >(
                        item: T
                    ): T => {
                        const candidateId = Number(
                            item.xtream_id ??
                                item.stream_id ??
                                item.series_id ??
                                item.id
                        );
                        if (candidateId !== targetId) {
                            return item;
                        }

                        return {
                            ...item,
                            mediaMetadata: metadata,
                            audioLanguages: metadata.audioLanguages,
                            subtitleLanguages: metadata.subtitleLanguages,
                        };
                    };

                    patchState(store, (state) => {
                        if (contentType === 'live') {
                            return {
                                liveStreams:
                                    state.liveStreams.map(patchItem),
                            };
                        }

                        if (contentType === 'vod') {
                            return {
                                vodStreams: state.vodStreams.map(patchItem),
                            };
                        }

                        return {
                            serialStreams:
                                state.serialStreams.map(patchItem),
                        };
                    });
                },

                /**
                 * Reset content state
                 */
                resetContent(): void {
                    cachedHydrationGeneration += 1;
                    imdbRatingHydrationGeneration = {
                        vod: imdbRatingHydrationGeneration.vod + 1,
                        series: imdbRatingHydrationGeneration.series + 1,
                    };
                    activeCachedHydrationPromises.clear();
                    patchState(store, initialContentState);
                },
            };

            return methods;
        })
    );
}
