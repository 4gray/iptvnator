export const DB_WORKER_OPERATIONS = [
    'DB_HAS_CATEGORIES',
    'DB_GET_CATEGORIES',
    'DB_SAVE_CATEGORIES',
    'DB_GET_ALL_CATEGORIES',
    'DB_UPDATE_CATEGORY_VISIBILITY',
    'DB_HAS_CONTENT',
    'DB_GET_CONTENT',
    'DB_GET_GLOBAL_RECENTLY_ADDED',
    'DB_SAVE_CONTENT',
    'DB_CLEAR_XTREAM_IMPORT_CACHE',
    'DB_GET_CONTENT_BY_XTREAM_ID',
    'DB_SEARCH_CONTENT',
    'DB_GLOBAL_SEARCH',
    'DB_CREATE_PLAYLIST',
    'DB_UPSERT_APP_PLAYLIST',
    'DB_UPSERT_APP_PLAYLISTS',
    'DB_GET_APP_PLAYLISTS',
    'DB_GET_APP_PLAYLIST',
    'DB_GET_PLAYLIST',
    'DB_UPDATE_PLAYLIST',
    'DB_DELETE_PLAYLIST',
    'DB_GET_APP_STATE',
    'DB_SET_APP_STATE',
    'DB_DELETE_ALL_PLAYLISTS',
    'DB_DELETE_XTREAM_CONTENT',
    'DB_RESTORE_XTREAM_USER_DATA',
    'DB_ADD_FAVORITE',
    'DB_REMOVE_FAVORITE',
    'DB_IS_FAVORITE',
    'DB_GET_FAVORITES',
    'DB_GET_GLOBAL_FAVORITES',
    'DB_GET_ALL_GLOBAL_FAVORITES',
    'DB_REORDER_GLOBAL_FAVORITES',
    'DB_GET_RECENTLY_VIEWED',
    'DB_CLEAR_RECENTLY_VIEWED',
    'DB_GET_RECENT_ITEMS',
    'DB_ADD_RECENT_ITEM',
    'DB_CLEAR_PLAYLIST_RECENT_ITEMS',
    'DB_REMOVE_RECENT_ITEM',
    'DB_SAVE_PLAYBACK_POSITION',
    'DB_GET_PLAYBACK_POSITION',
    'DB_GET_SERIES_PLAYBACK_POSITIONS',
    'DB_GET_RECENT_PLAYBACK_POSITIONS',
    'DB_GET_ALL_PLAYBACK_POSITIONS',
    'DB_CLEAR_PLAYBACK_POSITION',
] as const;

export type DbWorkerOperation = (typeof DB_WORKER_OPERATIONS)[number];

export const DB_OPERATION_NAMES = {
    SAVE_CONTENT: 'save-content',
    DELETE_XTREAM_CONTENT: 'delete-xtream-content',
    RESTORE_XTREAM_USER_DATA: 'restore-xtream-user-data',
    DELETE_PLAYLIST: 'delete-playlist',
    DELETE_ALL_PLAYLISTS: 'delete-all-playlists',
} as const;

export type DbOperationName =
    (typeof DB_OPERATION_NAMES)[keyof typeof DB_OPERATION_NAMES];

export const DB_OPERATION_PHASES = {
    PREPARING_CONTENT: 'preparing-content',
    SAVING_CONTENT: 'saving-content',
    COLLECTING_USER_DATA: 'collecting-user-data',
    DELETING_FAVORITES: 'deleting-favorites',
    DELETING_RECENTLY_VIEWED: 'deleting-recently-viewed',
    DELETING_PLAYBACK_POSITIONS: 'deleting-playback-positions',
    DELETING_DOWNLOADS: 'deleting-downloads',
    DELETING_CONTENT: 'deleting-content',
    DELETING_CATEGORIES: 'deleting-categories',
    DELETING_PLAYLIST: 'deleting-playlist',
    DELETING_PLAYLISTS: 'deleting-playlists',
    RESTORING_FAVORITES: 'restoring-favorites',
    RESTORING_RECENTLY_VIEWED: 'restoring-recently-viewed',
} as const;

export type DbOperationStatus =
    | 'started'
    | 'progress'
    | 'completed'
    | 'cancelled'
    | 'error';

export interface DbOperationEvent {
    operationId?: string;
    operation: DbOperationName | string;
    playlistId?: string;
    status: DbOperationStatus;
    phase?: string;
    current?: number;
    total?: number;
    increment?: number;
    error?: string;
}

export interface SerializedWorkerError {
    name?: string;
    message: string;
    stack?: string;
}

export interface DbWorkerRequestMessage<TPayload = unknown> {
    type: 'request';
    requestId: string;
    operation: DbWorkerOperation;
    payload: TPayload;
}

export interface DbWorkerCancelMessage {
    type: 'cancel';
    operationId: string;
}

export interface DbWorkerReadyMessage {
    type: 'ready';
}

export interface DbWorkerEventMessage {
    type: 'event';
    requestId: string;
    event: DbOperationEvent;
}

export interface DbWorkerResponseMessage<TResult = unknown> {
    type: 'response';
    requestId: string;
    success: boolean;
    result?: TResult;
    error?: SerializedWorkerError;
}

export type DbWorkerIncomingMessage =
    | DbWorkerRequestMessage
    | DbWorkerCancelMessage;

export type DbWorkerMessage =
    | DbWorkerReadyMessage
    | DbWorkerEventMessage
    | DbWorkerResponseMessage;
