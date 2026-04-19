import {
    closeWorkerDatabase,
    getWorkerDatabase,
} from './database.worker-connection';
import { parentPort } from 'worker_threads';
import type {
    DbOperationEvent,
    DbWorkerIncomingMessage,
    DbWorkerMessage,
    DbWorkerRequestMessage,
} from './database-worker.types';
import {
    DB_OPERATION_NAMES,
    DB_OPERATION_PHASES,
} from './database-worker.types';
import {
    getAllCategories,
    getCategories,
    hasCategories,
    saveCategories,
    updateCategoryVisibility,
} from '../database/operations/category.operations';
import {
    addFavorite,
    getAllGlobalFavorites,
    getFavorites,
    getGlobalFavorites,
    isFavorite,
    removeFavorite,
    reorderGlobalFavorites,
} from '../database/operations/favorites.operations';
import {
    clearXtreamImportCache,
    getContent,
    getContentByXtreamId,
    getGlobalRecentlyAdded,
    globalSearch,
    hasContent,
    saveContent,
    searchContent,
} from '../database/operations/content.operations';
import {
    clearPlaybackPosition,
    getAllPlaybackPositions,
    getPlaybackPosition,
    getRecentPlaybackPositions,
    getSeriesPlaybackPositions,
    savePlaybackPosition,
} from '../database/operations/playback-position.operations';
import {
    createPlaylist,
    deleteAllPlaylists,
    deletePlaylist,
    getAppPlaylist,
    getAppPlaylists,
    getAppState,
    getPlaylist,
    setAppState,
    updatePlaylist,
    upsertAppPlaylist,
    upsertAppPlaylists,
} from '../database/operations/playlist.operations';
import {
    addRecentItem,
    clearPlaylistRecentItems,
    clearRecentlyViewed,
    getRecentItems,
    getRecentlyViewed,
    removeRecentItem,
} from '../database/operations/recently-viewed.operations';
import {
    deleteXtreamContent,
    restoreXtreamUserData,
} from '../database/operations/xtream.operations';

const loggerLabel = '[DB Worker]';
const batchDelayMs = Number.parseInt(
    process.env['IPTVNATOR_DB_WORKER_BATCH_DELAY_MS'] ?? '0',
    10
);

type ActiveOperationState = {
    cancelled: boolean;
};

type OperationController = {
    control: {
        checkpoint: () => Promise<void>;
        onProgress: (progress: {
            phase: string;
            current?: number;
            total?: number;
            increment?: number;
        }) => Promise<void>;
    };
    emitStarted: (event: Partial<DbOperationEvent> & { phase: string }) => void;
    emitCompleted: (
        event?: Partial<DbOperationEvent> & { phase?: string }
    ) => void;
    emitCancelled: (
        event?: Partial<DbOperationEvent> & { phase?: string }
    ) => void;
    emitError: (
        error: unknown,
        event?: Partial<DbOperationEvent> & { phase?: string }
    ) => void;
    cleanup: () => void;
};

const activeOperations = new Map<string, ActiveOperationState>();

if (!parentPort) {
    throw new Error('Database worker must be started with a parent port');
}

function createAbortError(message: string): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function serializeError(error: unknown) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }

    return {
        message: String(error),
    };
}

function postMessage(message: DbWorkerMessage): void {
    parentPort?.postMessage(message);
}

function postEvent(requestId: string, event: DbOperationEvent): void {
    postMessage({
        type: 'event',
        requestId,
        event,
    });
}

async function pauseBetweenBatches(): Promise<void> {
    if (batchDelayMs <= 0) {
        return;
    }

    await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
}

function createOperationController(config: {
    operationId?: string;
    operation: string;
    playlistId?: string;
    requestId: string;
    cancellable?: boolean;
}): OperationController {
    const { operationId, operation, playlistId, requestId } = config;
    const cancellable = config.cancellable ?? true;
    const activeState =
        operationId && cancellable
            ? { cancelled: false }
            : null;

    if (operationId && activeState) {
        activeOperations.set(operationId, activeState);
    }

    let lastEvent: Partial<DbOperationEvent> = {};

    const send = (
        status: DbOperationEvent['status'],
        event: Partial<DbOperationEvent> = {}
    ): void => {
        const mergedEvent: DbOperationEvent = {
            operationId,
            operation,
            playlistId,
            status,
            phase: event.phase ?? lastEvent.phase,
            current: event.current ?? lastEvent.current,
            total: event.total ?? lastEvent.total,
            increment: event.increment,
            error: event.error,
        };

        lastEvent = {
            phase: mergedEvent.phase,
            current: mergedEvent.current,
            total: mergedEvent.total,
        };
        postEvent(requestId, mergedEvent);
    };

    const checkpoint = async (): Promise<void> => {
        if (activeState?.cancelled) {
            throw createAbortError(`Operation "${operation}" was cancelled`);
        }

        await pauseBetweenBatches();

        if (activeState?.cancelled) {
            throw createAbortError(`Operation "${operation}" was cancelled`);
        }
    };

    return {
        control: {
            checkpoint,
            onProgress: async (progress) => {
                send('progress', progress);
            },
        },
        emitStarted: (event) => {
            send('started', event);
        },
        emitCompleted: (event) => {
            send('completed', event);
        },
        emitCancelled: (event) => {
            send('cancelled', event);
        },
        emitError: (error, event) => {
            send('error', {
                ...event,
                error:
                    error instanceof Error ? error.message : String(error),
            });
        },
        cleanup: () => {
            if (operationId) {
                activeOperations.delete(operationId);
            }
        },
    };
}

async function executeTrackedOperation<TResult>(
    config: Parameters<typeof createOperationController>[0],
    handler: (controller: OperationController) => Promise<TResult>
): Promise<TResult> {
    const controller = createOperationController(config);

    try {
        return await handler(controller);
    } catch (error) {
        if (isAbortError(error)) {
            controller.emitCancelled();
        } else {
            controller.emitError(error);
        }
        throw error;
    } finally {
        controller.cleanup();
    }
}

async function executeRequest(message: DbWorkerRequestMessage) {
    const db = await getWorkerDatabase();

    switch (message.operation) {
        case 'DB_HAS_CATEGORIES': {
            const payload = message.payload as {
                playlistId: string;
                type: 'live' | 'movies' | 'series';
            };
            return hasCategories(db, payload.playlistId, payload.type);
        }

        case 'DB_GET_CATEGORIES': {
            const payload = message.payload as {
                playlistId: string;
                type: 'live' | 'movies' | 'series';
            };
            return getCategories(db, payload.playlistId, payload.type);
        }

        case 'DB_SAVE_CATEGORIES': {
            const payload = message.payload as {
                playlistId: string;
                categories: Array<{
                    category_name: string;
                    category_id: string | number;
                }>;
                type: 'live' | 'movies' | 'series';
                hiddenCategoryXtreamIds?: number[];
            };
            return saveCategories(
                db,
                payload.playlistId,
                payload.categories,
                payload.type,
                payload.hiddenCategoryXtreamIds
            );
        }

        case 'DB_GET_ALL_CATEGORIES': {
            const payload = message.payload as {
                playlistId: string;
                type: 'live' | 'movies' | 'series';
            };
            return getAllCategories(db, payload.playlistId, payload.type);
        }

        case 'DB_UPDATE_CATEGORY_VISIBILITY': {
            const payload = message.payload as {
                categoryIds: number[];
                hidden: boolean;
            };
            return updateCategoryVisibility(
                db,
                payload.categoryIds,
                payload.hidden
            );
        }

        case 'DB_HAS_CONTENT': {
            const payload = message.payload as {
                playlistId: string;
                type: 'live' | 'movie' | 'series';
            };
            return hasContent(db, payload.playlistId, payload.type);
        }

        case 'DB_GET_CONTENT': {
            const payload = message.payload as {
                playlistId: string;
                type: 'live' | 'movie' | 'series';
            };
            return getContent(db, payload.playlistId, payload.type);
        }

        case 'DB_GET_GLOBAL_RECENTLY_ADDED': {
            const payload = message.payload as {
                kind?: 'all' | 'vod' | 'series';
                limit?: number;
            };
            return getGlobalRecentlyAdded(db, payload.kind, payload.limit);
        }

        case 'DB_SAVE_CONTENT': {
            const payload = message.payload as {
                playlistId: string;
                streams: Array<Record<string, unknown>>;
                type: 'live' | 'movie' | 'series';
                operationId?: string;
            };

            return executeTrackedOperation(
                {
                    requestId: message.requestId,
                    operation: DB_OPERATION_NAMES.SAVE_CONTENT,
                    operationId: payload.operationId,
                    playlistId: payload.playlistId,
                },
                async (controller) => {
                    controller.emitStarted({
                        phase: DB_OPERATION_PHASES.PREPARING_CONTENT,
                        current: 0,
                        total: payload.streams.length,
                    });

                    const result = await saveContent(
                        db,
                        payload.playlistId,
                        payload.streams,
                        payload.type,
                        controller.control
                    );

                    controller.emitCompleted({
                        phase: DB_OPERATION_PHASES.SAVING_CONTENT,
                        current: result.count,
                        total: result.count,
                    });

                    return result;
                }
            );
        }

        case 'DB_CLEAR_XTREAM_IMPORT_CACHE': {
            const payload = message.payload as {
                playlistId: string;
                type: 'live' | 'movie' | 'series';
            };

            return clearXtreamImportCache(db, payload.playlistId, payload.type);
        }

        case 'DB_GET_CONTENT_BY_XTREAM_ID': {
            const payload = message.payload as {
                xtreamId: number;
                playlistId: string;
                contentType?: 'live' | 'movie' | 'series';
            };
            return getContentByXtreamId(
                db,
                payload.xtreamId,
                payload.playlistId,
                payload.contentType
            );
        }

        case 'DB_SEARCH_CONTENT': {
            const payload = message.payload as {
                playlistId: string;
                searchTerm: string;
                types: string[];
                excludeHidden?: boolean;
            };
            return searchContent(
                db,
                payload.playlistId,
                payload.searchTerm,
                payload.types,
                payload.excludeHidden
            );
        }

        case 'DB_GLOBAL_SEARCH': {
            const payload = message.payload as {
                searchTerm: string;
                types: string[];
                excludeHidden?: boolean;
            };
            return globalSearch(
                db,
                payload.searchTerm,
                payload.types,
                payload.excludeHidden
            );
        }

        case 'DB_CREATE_PLAYLIST': {
            return createPlaylist(
                db,
                message.payload as {
                    id: string;
                    name: string;
                    serverUrl?: string;
                    username?: string;
                    password?: string;
                    macAddress?: string;
                    url?: string;
                    type: string;
                }
            );
        }

        case 'DB_UPSERT_APP_PLAYLIST': {
            return upsertAppPlaylist(
                db,
                message.payload as Record<string, unknown>
            );
        }

        case 'DB_UPSERT_APP_PLAYLISTS': {
            return upsertAppPlaylists(
                db,
                message.payload as Record<string, unknown>[]
            );
        }

        case 'DB_GET_APP_PLAYLISTS':
            return getAppPlaylists(db);

        case 'DB_GET_APP_PLAYLIST': {
            const payload = message.payload as { playlistId: string };
            return getAppPlaylist(db, payload.playlistId);
        }

        case 'DB_GET_PLAYLIST': {
            const payload = message.payload as { playlistId: string };
            return getPlaylist(db, payload.playlistId);
        }

        case 'DB_UPDATE_PLAYLIST': {
            const payload = message.payload as {
                playlistId: string;
                updates: {
                    name?: string;
                    username?: string;
                    password?: string;
                    serverUrl?: string;
                    lastUpdated?: string;
                };
            };
            return updatePlaylist(db, payload.playlistId, payload.updates);
        }

        case 'DB_DELETE_PLAYLIST': {
            const payload = message.payload as {
                playlistId: string;
                operationId?: string;
            };

            return executeTrackedOperation(
                {
                    requestId: message.requestId,
                    operation: DB_OPERATION_NAMES.DELETE_PLAYLIST,
                    operationId: payload.operationId,
                    playlistId: payload.playlistId,
                },
                async (controller) => {
                    controller.emitStarted({
                        phase: DB_OPERATION_PHASES.DELETING_FAVORITES,
                        current: 0,
                    });

                    const result = await deletePlaylist(
                        db,
                        payload.playlistId,
                        controller.control
                    );

                    controller.emitCompleted({
                        phase: DB_OPERATION_PHASES.DELETING_PLAYLIST,
                        current: 1,
                        total: 1,
                    });

                    return result;
                }
            );
        }

        case 'DB_GET_APP_STATE': {
            const payload = message.payload as { key: string };
            return getAppState(db, payload.key);
        }

        case 'DB_SET_APP_STATE': {
            const payload = message.payload as { key: string; value: string };
            return setAppState(db, payload.key, payload.value);
        }

        case 'DB_DELETE_ALL_PLAYLISTS': {
            const payload = message.payload as { operationId?: string };

            return executeTrackedOperation(
                {
                    requestId: message.requestId,
                    operation: DB_OPERATION_NAMES.DELETE_ALL_PLAYLISTS,
                    operationId: payload.operationId,
                    cancellable: false,
                },
                async (controller) => {
                    controller.emitStarted({
                        phase: DB_OPERATION_PHASES.DELETING_FAVORITES,
                        current: 0,
                        total: 7,
                    });

                    const result = await deleteAllPlaylists(
                        db,
                        controller.control
                    );

                    controller.emitCompleted({
                        phase: DB_OPERATION_PHASES.DELETING_PLAYLISTS,
                        current: 7,
                        total: 7,
                    });

                    return result;
                }
            );
        }

        case 'DB_DELETE_XTREAM_CONTENT': {
            const payload = message.payload as {
                playlistId: string;
                operationId?: string;
            };

            return executeTrackedOperation(
                {
                    requestId: message.requestId,
                    operation: DB_OPERATION_NAMES.DELETE_XTREAM_CONTENT,
                    operationId: payload.operationId,
                    playlistId: payload.playlistId,
                },
                async (controller) => {
                    controller.emitStarted({
                        phase: DB_OPERATION_PHASES.COLLECTING_USER_DATA,
                        current: 0,
                    });

                    const result = await deleteXtreamContent(
                        db,
                        payload.playlistId,
                        controller.control
                    );

                    controller.emitCompleted({
                        phase: DB_OPERATION_PHASES.DELETING_CATEGORIES,
                    });

                    return result;
                }
            );
        }

        case 'DB_RESTORE_XTREAM_USER_DATA': {
            const payload = message.payload as {
                playlistId: string;
                favoritedXtreamIds: number[];
                recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[];
                operationId?: string;
            };

            return executeTrackedOperation(
                {
                    requestId: message.requestId,
                    operation: DB_OPERATION_NAMES.RESTORE_XTREAM_USER_DATA,
                    operationId: payload.operationId,
                    playlistId: payload.playlistId,
                },
                async (controller) => {
                    const totalItems =
                        payload.favoritedXtreamIds.length +
                        payload.recentlyViewedXtreamIds.length;
                    controller.emitStarted({
                        phase: DB_OPERATION_PHASES.RESTORING_FAVORITES,
                        current: 0,
                        total: totalItems,
                    });

                    const result = await restoreXtreamUserData(
                        db,
                        payload.playlistId,
                        payload.favoritedXtreamIds,
                        payload.recentlyViewedXtreamIds,
                        controller.control
                    );

                    controller.emitCompleted({
                        phase: DB_OPERATION_PHASES.RESTORING_RECENTLY_VIEWED,
                        current: totalItems,
                        total: totalItems,
                    });

                    return result;
                }
            );
        }

        case 'DB_ADD_FAVORITE': {
            const payload = message.payload as {
                contentId: number;
                playlistId: string;
            };
            return addFavorite(db, payload.contentId, payload.playlistId);
        }

        case 'DB_REMOVE_FAVORITE': {
            const payload = message.payload as {
                contentId: number;
                playlistId: string;
            };
            return removeFavorite(db, payload.contentId, payload.playlistId);
        }

        case 'DB_IS_FAVORITE': {
            const payload = message.payload as {
                contentId: number;
                playlistId: string;
            };
            return isFavorite(db, payload.contentId, payload.playlistId);
        }

        case 'DB_GET_FAVORITES': {
            const payload = message.payload as { playlistId: string };
            return getFavorites(db, payload.playlistId);
        }

        case 'DB_GET_GLOBAL_FAVORITES':
            return getGlobalFavorites(db);

        case 'DB_GET_ALL_GLOBAL_FAVORITES':
            return getAllGlobalFavorites(db);

        case 'DB_REORDER_GLOBAL_FAVORITES': {
            const payload = message.payload as {
                updates: { content_id: number; position: number }[];
            };
            return reorderGlobalFavorites(db, payload.updates);
        }

        case 'DB_GET_RECENTLY_VIEWED':
            return getRecentlyViewed(db);

        case 'DB_CLEAR_RECENTLY_VIEWED':
            return clearRecentlyViewed(db);

        case 'DB_GET_RECENT_ITEMS': {
            const payload = message.payload as { playlistId: string };
            return getRecentItems(db, payload.playlistId);
        }

        case 'DB_ADD_RECENT_ITEM': {
            const payload = message.payload as {
                contentId: number;
                playlistId: string;
            };
            return addRecentItem(db, payload.contentId, payload.playlistId);
        }

        case 'DB_CLEAR_PLAYLIST_RECENT_ITEMS': {
            const payload = message.payload as { playlistId: string };
            return clearPlaylistRecentItems(db, payload.playlistId);
        }

        case 'DB_REMOVE_RECENT_ITEM': {
            const payload = message.payload as {
                contentId: number;
                playlistId: string;
            };
            return removeRecentItem(db, payload.contentId, payload.playlistId);
        }

        case 'DB_SAVE_PLAYBACK_POSITION': {
            const payload = message.payload as {
                playlistId: string;
                data: {
                    contentXtreamId: number;
                    contentType: 'vod' | 'episode';
                    seriesXtreamId?: number;
                    seasonNumber?: number;
                    episodeNumber?: number;
                    positionSeconds: number;
                    durationSeconds?: number;
                    playlistType?: 'xtream' | 'stalker' | 'm3u-file' | 'm3u-text' | 'm3u-url';
                };
            };
            return savePlaybackPosition(db, payload.playlistId, payload.data);
        }

        case 'DB_GET_PLAYBACK_POSITION': {
            const payload = message.payload as {
                playlistId: string;
                contentXtreamId: number;
                contentType: 'vod' | 'episode';
            };
            return getPlaybackPosition(
                db,
                payload.playlistId,
                payload.contentXtreamId,
                payload.contentType
            );
        }

        case 'DB_GET_SERIES_PLAYBACK_POSITIONS': {
            const payload = message.payload as {
                playlistId: string;
                seriesXtreamId: number;
            };
            return getSeriesPlaybackPositions(
                db,
                payload.playlistId,
                payload.seriesXtreamId
            );
        }

        case 'DB_GET_RECENT_PLAYBACK_POSITIONS': {
            const payload = message.payload as {
                playlistId: string;
                limit?: number;
            };
            return getRecentPlaybackPositions(
                db,
                payload.playlistId,
                payload.limit
            );
        }

        case 'DB_GET_ALL_PLAYBACK_POSITIONS': {
            const payload = message.payload as { playlistId: string };
            return getAllPlaybackPositions(db, payload.playlistId);
        }

        case 'DB_CLEAR_PLAYBACK_POSITION': {
            const payload = message.payload as {
                playlistId: string;
                contentXtreamId: number;
                contentType: 'vod' | 'episode';
            };
            return clearPlaybackPosition(
                db,
                payload.playlistId,
                payload.contentXtreamId,
                payload.contentType
            );
        }
    }
}

parentPort.on('message', async (message: DbWorkerIncomingMessage) => {
    if (message.type === 'cancel') {
        const activeOperation = activeOperations.get(message.operationId);
        if (activeOperation) {
            activeOperation.cancelled = true;
        }
        return;
    }

    try {
        const result = await executeRequest(message);
        postMessage({
            type: 'response',
            requestId: message.requestId,
            success: true,
            result,
        });
    } catch (error) {
        console.error(loggerLabel, `Error handling ${message.operation}:`, error);
        postMessage({
            type: 'response',
            requestId: message.requestId,
            success: false,
            error: serializeError(error),
        });
    }
});

process.on('exit', () => {
    closeWorkerDatabase();
});

postMessage({ type: 'ready' });
