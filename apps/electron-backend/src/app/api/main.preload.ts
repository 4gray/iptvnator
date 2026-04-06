import { contextBridge, ipcRenderer } from 'electron';
import type {
    ExternalPlayerSession,
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
    XtreamCategory,
} from 'shared-interfaces';
import {
    DEBUG_TRACE_EVENT_CHANNEL,
    isRendererApiTraceEnabled,
    roundTraceDuration,
    summarizeForTrace,
} from '../services/debug-trace';

const PORTAL_DEBUG_EVENT = 'PORTAL_DEBUG_EVENT';
const EXTERNAL_PLAYER_SESSION_UPDATE = 'EXTERNAL_PLAYER_SESSION_UPDATE';
const DB_OPERATION_EVENT = 'DB_OPERATION_EVENT';
const PLAYLIST_REFRESH_EVENT = 'PLAYLIST:REFRESH_EVENT';

type PortalDebugEvent = {
    requestId: string;
    provider: 'xtream' | 'stalker';
    operation: string;
    transport: 'electron-main' | 'electron-renderer' | 'pwa-http';
    startedAt: string;
    durationMs: number;
    status: 'success' | 'error';
    request: unknown;
    response?: unknown;
    error?: unknown;
};

type DbOperationEvent = {
    operationId?: string;
    operation: string;
    playlistId?: string;
    status: 'started' | 'progress' | 'completed' | 'cancelled' | 'error';
    phase?: string;
    current?: number;
    total?: number;
    increment?: number;
    error?: string;
};

const dbSaveContentProgressListeners = new Set<
    (event: Electron.IpcRendererEvent, data: DbOperationEvent) => void
>();

const shouldTraceRendererApi = isRendererApiTraceEnabled();

function emitRendererTrace(payload: {
    method: string;
    phase: 'start' | 'success' | 'error';
    args?: unknown;
    durationMs?: number;
    error?: unknown;
    result?: unknown;
}): void {
    if (!shouldTraceRendererApi) {
        return;
    }

    ipcRenderer.send(DEBUG_TRACE_EVENT_CHANNEL, payload);
}

function wrapElectronApi<T extends Record<string, unknown>>(api: T): T {
    if (!shouldTraceRendererApi) {
        return api;
    }

    return Object.fromEntries(
        Object.entries(api).map(([name, value]) => {
            if (
                typeof value !== 'function' ||
                name.startsWith('on') ||
                name.startsWith('remove')
            ) {
                return [name, value];
            }

            const original = value as (...args: unknown[]) => unknown;

            return [
                name,
                (...args: unknown[]) => {
                    const startedAt =
                        globalThis.performance?.now?.() ?? Date.now();
                    emitRendererTrace({
                        args: summarizeForTrace(args),
                        method: name,
                        phase: 'start',
                    });

                    try {
                        const result = original(...args);

                        if (
                            result &&
                            typeof (result as PromiseLike<unknown>).then ===
                                'function'
                        ) {
                            return (result as Promise<unknown>)
                                .then((resolvedValue) => {
                                    emitRendererTrace({
                                        durationMs: roundTraceDuration(
                                            (globalThis.performance?.now?.() ??
                                                Date.now()) - startedAt
                                        ),
                                        method: name,
                                        phase: 'success',
                                        result: summarizeForTrace(
                                            resolvedValue
                                        ),
                                    });
                                    return resolvedValue;
                                })
                                .catch((error: unknown) => {
                                    emitRendererTrace({
                                        durationMs: roundTraceDuration(
                                            (globalThis.performance?.now?.() ??
                                                Date.now()) - startedAt
                                        ),
                                        error: summarizeForTrace(error),
                                        method: name,
                                        phase: 'error',
                                    });
                                    throw error;
                                });
                        }

                        emitRendererTrace({
                            durationMs: roundTraceDuration(
                                (globalThis.performance?.now?.() ??
                                    Date.now()) - startedAt
                            ),
                            method: name,
                            phase: 'success',
                            result: summarizeForTrace(result),
                        });

                        return result;
                    } catch (error) {
                        emitRendererTrace({
                            durationMs: roundTraceDuration(
                                (globalThis.performance?.now?.() ??
                                    Date.now()) - startedAt
                            ),
                            error: summarizeForTrace(error),
                            method: name,
                            phase: 'error',
                        });
                        throw error;
                    }
                },
            ];
        })
    ) as T;
}

const electronApi = {
    // Remote control channel change listener
    onChannelChange: (
        callback: (data: { direction: 'up' | 'down' }) => void
    ) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) =>
            callback(data);
        ipcRenderer.on('CHANNEL_CHANGE', handler);
        return () => ipcRenderer.off('CHANNEL_CHANGE', handler);
    },
    onRemoteControlCommand: (
        callback: (data: {
            type:
                | 'channel-select-number'
                | 'volume-up'
                | 'volume-down'
                | 'volume-toggle-mute';
            number?: number;
        }) => void
    ) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) =>
            callback(data);
        ipcRenderer.on('REMOTE_CONTROL_COMMAND', handler);
        return () => ipcRenderer.off('REMOTE_CONTROL_COMMAND', handler);
    },
    updateRemoteControlStatus: (status: any) => {
        ipcRenderer.send('REMOTE_CONTROL_STATUS_UPDATE', status);
    },
    // Player error listener
    onPlayerError: (
        callback: (data: {
            player: string;
            error: string;
            originalError: string;
        }) => void
    ) => {
        ipcRenderer.on('player-error', (_event, data) => callback(data));
    },
    onPortalDebugEvent: (callback: (data: PortalDebugEvent) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) =>
            callback(data as PortalDebugEvent);
        ipcRenderer.on(PORTAL_DEBUG_EVENT, handler);
        return () => ipcRenderer.off(PORTAL_DEBUG_EVENT, handler);
    },
    // EPG progress listener
    onEpgProgress: (
        callback: (data: {
            url: string;
            status: 'loading' | 'complete' | 'error';
            stats?: { totalChannels: number; totalPrograms: number };
            error?: string;
        }) => void
    ) => {
        ipcRenderer.on('EPG_PROGRESS_UPDATE', (_event, data) => callback(data));
    },
    // Playback position update listener - returns unsubscribe function
    onPlaybackPositionUpdate: (callback: (data: any) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) =>
            callback(data);
        ipcRenderer.on('playback-position-update', handler);
        return () => ipcRenderer.off('playback-position-update', handler);
    },
    onExternalPlayerSessionUpdate: (
        callback: (data: ExternalPlayerSession) => void
    ) => {
        const handler = (
            _event: Electron.IpcRendererEvent,
            data: ExternalPlayerSession
        ) => callback(data);
        ipcRenderer.on(EXTERNAL_PLAYER_SESSION_UPDATE, handler);
        return () => ipcRenderer.off(EXTERNAL_PLAYER_SESSION_UPDATE, handler);
    },
    onDbOperationEvent: (callback: (data: DbOperationEvent) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) =>
            callback(data as DbOperationEvent);
        ipcRenderer.on(DB_OPERATION_EVENT, handler);
        return () => ipcRenderer.off(DB_OPERATION_EVENT, handler);
    },
    onPlaylistRefreshEvent: (
        callback: (data: PlaylistRefreshEvent) => void
    ) => {
        const handler = (_event: Electron.IpcRendererEvent, data: any) =>
            callback(data as PlaylistRefreshEvent);
        ipcRenderer.on(PLAYLIST_REFRESH_EVENT, handler);
        return () => ipcRenderer.off(PLAYLIST_REFRESH_EVENT, handler);
    },
    // DB save content progress listener
    onDbSaveContentProgress: (callback: (count: number) => void) => {
        const handler = (
            _event: Electron.IpcRendererEvent,
            data: DbOperationEvent
        ) => {
            if (
                data.operation !== 'save-content' ||
                data.status !== 'progress'
            ) {
                return;
            }

            callback(data.increment ?? data.current ?? 0);
        };

        dbSaveContentProgressListeners.add(handler);
        ipcRenderer.on(DB_OPERATION_EVENT, handler);
    },
    // Remove DB save content progress listener
    removeDbSaveContentProgress: () => {
        dbSaveContentProgressListeners.forEach((handler) => {
            ipcRenderer.off(DB_OPERATION_EVENT, handler);
        });
        dbSaveContentProgressListeners.clear();
    },
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    platform: process.platform,
    fetchPlaylistByUrl: (url: string, title?: string) =>
        ipcRenderer.invoke('fetch-playlist-by-url', url, title),
    updatePlaylistFromFilePath: (filePath: string, title: string) =>
        ipcRenderer.invoke('update-playlist-from-file-path', filePath, title),
    openPlaylistFromFile: () => ipcRenderer.invoke('open-playlist-from-file'),
    saveFileDialog: (
        defaultPath: string,
        filters?: { name: string; extensions: string[] }[]
    ) => ipcRenderer.invoke('save-file-dialog', defaultPath, filters),
    writeFile: (filePath: string, content: string) =>
        ipcRenderer.invoke('write-file', filePath, content),
    setUserAgent: (userAgent: string, referer?: string) =>
        ipcRenderer.invoke('set-user-agent', userAgent, referer),
    openInMpv: (
        url: string,
        title: string,
        thumbnail: string,
        userAgent: string,
        referer?: string,
        origin?: string,
        contentInfo?: any,
        startTime?: number,
        headers?: Record<string, string>
    ): Promise<ExternalPlayerSession> =>
        ipcRenderer.invoke(
            'OPEN_MPV_PLAYER',
            url,
            title,
            thumbnail,
            userAgent,
            referer,
            origin,
            contentInfo,
            startTime,
            headers
        ),
    openInVlc: (
        url: string,
        title: string,
        thumbnail: string,
        userAgent: string,
        referer?: string,
        origin?: string,
        contentInfo?: any,
        startTime?: number,
        headers?: Record<string, string>
    ): Promise<ExternalPlayerSession> =>
        ipcRenderer.invoke(
            'OPEN_VLC_PLAYER',
            url,
            title,
            thumbnail,
            userAgent,
            referer,
            origin,
            contentInfo,
            startTime,
            headers
        ),
    closeExternalPlayerSession: (sessionId: string) =>
        ipcRenderer.invoke('CLOSE_EXTERNAL_PLAYER_SESSION', sessionId),
    autoUpdatePlaylists: (playlists) =>
        ipcRenderer.invoke('AUTO_UPDATE', playlists),
    fetchEpg: (urls: string[]) =>
        ipcRenderer.invoke('FETCH_EPG', { url: urls }),
    getChannelPrograms: (channelId: string) =>
        ipcRenderer.invoke('GET_CHANNEL_PROGRAMS', { channelId }),
    getEpgChannels: () => ipcRenderer.invoke('EPG_GET_CHANNELS'),
    getEpgChannelsByRange: (skip: number, limit: number) =>
        ipcRenderer.invoke('EPG_GET_CHANNELS_BY_RANGE', { skip, limit }),
    forceFetchEpg: (url: string) => ipcRenderer.invoke('EPG_FORCE_FETCH', url),
    clearEpgData: () => ipcRenderer.invoke('EPG_CLEAR_ALL'),
    checkEpgFreshness: (urls: string[], maxAgeHours?: number) =>
        ipcRenderer.invoke('EPG_CHECK_FRESHNESS', { urls, maxAgeHours }),
    searchEpgPrograms: (searchTerm: string, limit?: number) =>
        ipcRenderer.invoke('EPG_DB_SEARCH_PROGRAMS', searchTerm, limit),
    setMpvPlayerPath: (mpvPlayerPath: string) =>
        ipcRenderer.invoke('SET_MPV_PLAYER_PATH', mpvPlayerPath),
    setVlcPlayerPath: (vlcPlayerPath: string) =>
        ipcRenderer.invoke('SET_VLC_PLAYER_PATH', vlcPlayerPath),
    updateSettings: (settings: any) =>
        ipcRenderer.invoke('SETTINGS_UPDATE', settings),
    getAiSettings: () => ipcRenderer.invoke('GET_AI_SETTINGS'),
    stalkerRequest: (payload: {
        url: string;
        macAddress: string;
        params: Record<string, string>;
        token?: string;
        serialNumber?: string;
        requestId?: string;
    }) => ipcRenderer.invoke('STALKER_REQUEST', payload),
    xtreamRequest: (payload: {
        url: string;
        params: Record<string, string>;
        requestId?: string;
        sessionId?: string;
        suppressErrorLog?: boolean;
    }) => ipcRenderer.invoke('XTREAM_REQUEST', payload),
    xtreamCancelSession: (sessionId: string) =>
        ipcRenderer.invoke('XTREAM_CANCEL_SESSION', sessionId),
    xtreamProbeUrl: (url: string, method?: 'GET' | 'HEAD') =>
        ipcRenderer.invoke('XTREAM_PROBE_URL', { url, method }),
    refreshPlaylist: (payload: PlaylistRefreshPayload) =>
        ipcRenderer.invoke('PLAYLIST:REFRESH', payload),
    cancelPlaylistRefresh: (operationId: string) =>
        ipcRenderer.invoke('PLAYLIST:CANCEL_REFRESH', operationId),
    // Database operations
    dbCreatePlaylist: (playlist: any) =>
        ipcRenderer.invoke('DB_CREATE_PLAYLIST', playlist),
    dbGetPlaylist: (playlistId: string) =>
        ipcRenderer.invoke('DB_GET_PLAYLIST', playlistId),
    dbUpsertAppPlaylist: (playlist: any) =>
        ipcRenderer.invoke('DB_UPSERT_APP_PLAYLIST', playlist),
    dbUpsertAppPlaylists: (playlists: any[]) =>
        ipcRenderer.invoke('DB_UPSERT_APP_PLAYLISTS', playlists),
    dbGetAppPlaylists: () => ipcRenderer.invoke('DB_GET_APP_PLAYLISTS'),
    dbGetAppPlaylist: (playlistId: string) =>
        ipcRenderer.invoke('DB_GET_APP_PLAYLIST', playlistId),
    dbUpdatePlaylist: (playlistId: string, updates: any) =>
        ipcRenderer.invoke('DB_UPDATE_PLAYLIST', playlistId, updates),
    dbDeletePlaylist: (playlistId: string, operationId?: string) =>
        ipcRenderer.invoke('DB_DELETE_PLAYLIST', playlistId, operationId),
    dbDeleteXtreamContent: (playlistId: string, operationId?: string) =>
        ipcRenderer.invoke(
            'DB_DELETE_XTREAM_CONTENT',
            playlistId,
            operationId
        ),
    dbRestoreXtreamUserData: (
        playlistId: string,
        favoritedXtreamIds: number[],
        recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[],
        operationId?: string
    ) =>
        ipcRenderer.invoke(
            'DB_RESTORE_XTREAM_USER_DATA',
            playlistId,
            favoritedXtreamIds,
            recentlyViewedXtreamIds,
            operationId
        ),
    dbHasCategories: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_HAS_CATEGORIES', playlistId, type),
    dbGetCategories: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_GET_CATEGORIES', playlistId, type),
    dbSaveCategories: (
        playlistId: string,
        categories: XtreamCategory[],
        type: string,
        hiddenCategoryXtreamIds?: number[]
    ) =>
        ipcRenderer.invoke(
            'DB_SAVE_CATEGORIES',
            playlistId,
            categories,
            type,
            hiddenCategoryXtreamIds
        ),
    dbGetAllCategories: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_GET_ALL_CATEGORIES', playlistId, type),
    dbUpdateCategoryVisibility: (categoryIds: number[], hidden: boolean) =>
        ipcRenderer.invoke(
            'DB_UPDATE_CATEGORY_VISIBILITY',
            categoryIds,
            hidden
        ),
    dbHasContent: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_HAS_CONTENT', playlistId, type),
    dbGetContent: (playlistId: string, type: string) =>
        ipcRenderer.invoke('DB_GET_CONTENT', playlistId, type),
    dbSaveContent: (
        playlistId: string,
        streams: any[],
        type: string,
        operationId?: string
    ) =>
        ipcRenderer.invoke(
            'DB_SAVE_CONTENT',
            playlistId,
            streams,
            type,
            operationId
        ),
    dbClearXtreamImportCache: (
        playlistId: string,
        type: 'live' | 'movie' | 'series'
    ) => ipcRenderer.invoke('DB_CLEAR_XTREAM_IMPORT_CACHE', playlistId, type),
    dbSearchContent: (
        playlistId: string,
        searchTerm: string,
        types: string[],
        excludeHidden?: boolean
    ) =>
        ipcRenderer.invoke(
            'DB_SEARCH_CONTENT',
            playlistId,
            searchTerm,
            types,
            excludeHidden
        ),
    dbGlobalSearch: (
        searchTerm: string,
        types: string[],
        excludeHidden?: boolean
    ) =>
        ipcRenderer.invoke(
            'DB_GLOBAL_SEARCH',
            searchTerm,
            types,
            excludeHidden
        ),
    dbGetGlobalRecentlyAdded: (
        kind: 'all' | 'vod' | 'series',
        limit?: number
    ) => ipcRenderer.invoke('DB_GET_GLOBAL_RECENTLY_ADDED', kind, limit),
    dbGetRecentlyViewed: () => ipcRenderer.invoke('DB_GET_RECENTLY_VIEWED'),
    dbClearRecentlyViewed: () => ipcRenderer.invoke('DB_CLEAR_RECENTLY_VIEWED'),
    // Favorites
    dbAddFavorite: (contentId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_ADD_FAVORITE', contentId, playlistId),
    dbRemoveFavorite: (contentId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_REMOVE_FAVORITE', contentId, playlistId),
    dbIsFavorite: (contentId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_IS_FAVORITE', contentId, playlistId),
    dbGetFavorites: (playlistId: string) =>
        ipcRenderer.invoke('DB_GET_FAVORITES', playlistId),
    dbGetGlobalFavorites: () => ipcRenderer.invoke('DB_GET_GLOBAL_FAVORITES'),
    dbGetAllGlobalFavorites: () => ipcRenderer.invoke('DB_GET_ALL_GLOBAL_FAVORITES'),
    dbReorderGlobalFavorites: (
        updates: { content_id: number; position: number }[]
    ) => ipcRenderer.invoke('DB_REORDER_GLOBAL_FAVORITES', updates),
    // Recently viewed (playlist-specific)
    dbGetRecentItems: (playlistId: string) =>
        ipcRenderer.invoke('DB_GET_RECENT_ITEMS', playlistId),
    dbAddRecentItem: (contentId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_ADD_RECENT_ITEM', contentId, playlistId),
    dbClearPlaylistRecentItems: (playlistId: string) =>
        ipcRenderer.invoke('DB_CLEAR_PLAYLIST_RECENT_ITEMS', playlistId),
    dbRemoveRecentItem: (contentId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_REMOVE_RECENT_ITEM', contentId, playlistId),
    dbGetContentByXtreamId: (xtreamId: number, playlistId: string) =>
        ipcRenderer.invoke('DB_GET_CONTENT_BY_XTREAM_ID', xtreamId, playlistId),
    dbDeleteAllPlaylists: (operationId?: string) =>
        ipcRenderer.invoke('DB_DELETE_ALL_PLAYLISTS', operationId),
    dbCancelOperation: (operationId: string) =>
        ipcRenderer.invoke('DB_CANCEL_OPERATION', operationId),
    dbGetAppState: (key: string) => ipcRenderer.invoke('DB_GET_APP_STATE', key),
    dbSetAppState: (key: string, value: string) =>
        ipcRenderer.invoke('DB_SET_APP_STATE', key, value),
    // Playback Positions
    dbSavePlaybackPosition: (playlistId: string, data: any) =>
        ipcRenderer.invoke('DB_SAVE_PLAYBACK_POSITION', playlistId, data),
    dbGetPlaybackPosition: (
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ) =>
        ipcRenderer.invoke(
            'DB_GET_PLAYBACK_POSITION',
            playlistId,
            contentXtreamId,
            contentType
        ),
    dbGetSeriesPlaybackPositions: (
        playlistId: string,
        seriesXtreamId: number
    ) =>
        ipcRenderer.invoke(
            'DB_GET_SERIES_PLAYBACK_POSITIONS',
            playlistId,
            seriesXtreamId
        ),
    dbGetRecentPlaybackPositions: (playlistId: string, limit?: number) =>
        ipcRenderer.invoke(
            'DB_GET_RECENT_PLAYBACK_POSITIONS',
            playlistId,
            limit
        ),
    dbGetAllPlaybackPositions: (playlistId: string) =>
        ipcRenderer.invoke('DB_GET_ALL_PLAYBACK_POSITIONS', playlistId),
    dbClearPlaybackPosition: (
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ) =>
        ipcRenderer.invoke(
            'DB_CLEAR_PLAYBACK_POSITION',
            playlistId,
            contentXtreamId,
            contentType
        ),
    getLocalIpAddresses: () => ipcRenderer.invoke('get-local-ip-addresses'),
    // Downloads
    downloadsStart: (data: {
        playlistId: string;
        xtreamId: number;
        contentType: 'vod' | 'episode';
        title: string;
        url: string;
        posterUrl?: string;
        downloadFolder: string;
        headers?: { userAgent?: string; referer?: string; origin?: string };
        seriesXtreamId?: number;
        seasonNumber?: number;
        episodeNumber?: number;
        // Playlist info for auto-creation if needed
        playlistName?: string;
        playlistType?:
            | 'xtream'
            | 'stalker'
            | 'm3u-file'
            | 'm3u-text'
            | 'm3u-url';
        serverUrl?: string;
        portalUrl?: string;
        macAddress?: string;
    }) => ipcRenderer.invoke('DOWNLOADS_START', data),
    downloadsCancel: (downloadId: number) =>
        ipcRenderer.invoke('DOWNLOADS_CANCEL', downloadId),
    downloadsRetry: (downloadId: number, downloadFolder: string) =>
        ipcRenderer.invoke('DOWNLOADS_RETRY', downloadId, downloadFolder),
    downloadsRemove: (downloadId: number) =>
        ipcRenderer.invoke('DOWNLOADS_REMOVE', downloadId),
    downloadsGetList: (playlistId?: string) =>
        ipcRenderer.invoke('DOWNLOADS_GET_LIST', playlistId),
    downloadsGet: (downloadId: number) =>
        ipcRenderer.invoke('DOWNLOADS_GET', downloadId),
    downloadsGetDefaultFolder: () =>
        ipcRenderer.invoke('DOWNLOADS_GET_DEFAULT_FOLDER'),
    downloadsSelectFolder: () => ipcRenderer.invoke('DOWNLOADS_SELECT_FOLDER'),
    downloadsRevealFile: (filePath: string) =>
        ipcRenderer.invoke('DOWNLOADS_REVEAL_FILE', filePath),
    downloadsPlayFile: (filePath: string) =>
        ipcRenderer.invoke('DOWNLOADS_PLAY_FILE', filePath),
    downloadsClearCompleted: (playlistId?: string) =>
        ipcRenderer.invoke('DOWNLOADS_CLEAR_COMPLETED', playlistId),
    onDownloadsUpdate: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('DOWNLOADS_UPDATE_EVENT', handler);
        return () => ipcRenderer.off('DOWNLOADS_UPDATE_EVENT', handler);
    },
};

contextBridge.exposeInMainWorld('electron', wrapElectronApi(electronApi));
