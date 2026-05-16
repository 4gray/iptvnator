/**
 * Content IPC event handlers
 * Operations for managing and searching content (streams, movies, series)
 */

import { ipcMain } from 'electron';
import {
    handleWorkerRequest,
    requestWorkerWithEvents,
} from './worker-events.utils';

handleWorkerRequest(
    'DB_HAS_CONTENT',
    (playlistId: string, type: 'live' | 'movie' | 'series') => ({
        playlistId,
        type,
    })
);

handleWorkerRequest(
    'DB_GET_CONTENT',
    (playlistId: string, type: 'live' | 'movie' | 'series') => ({
        playlistId,
        type,
    })
);

handleWorkerRequest(
    'DB_GET_GLOBAL_RECENTLY_ADDED',
    (
        kind: 'all' | 'vod' | 'series' = 'all',
        limit = 200,
        playlistType?:
            | 'xtream'
            | 'stalker'
            | 'm3u-file'
            | 'm3u-text'
            | 'm3u-url'
    ) => ({
        kind,
        limit,
        playlistType,
    })
);

ipcMain.handle(
    'DB_SAVE_CONTENT',
    async (
        event,
        playlistId: string,
        streams: Array<Record<string, unknown>>,
        type: 'live' | 'movie' | 'series',
        operationId?: string
    ) => {
        try {
            return await requestWorkerWithEvents(event, 'DB_SAVE_CONTENT', {
                playlistId,
                streams,
                type,
                operationId,
            });
        } catch (error) {
            console.error('Error handling DB_SAVE_CONTENT:', error);
            throw error;
        }
    }
);

handleWorkerRequest(
    'DB_CLEAR_XTREAM_IMPORT_CACHE',
    (playlistId: string, type: 'live' | 'movie' | 'series') => ({
        playlistId,
        type,
    })
);

handleWorkerRequest(
    'DB_GET_CONTENT_BY_XTREAM_ID',
    (
        xtreamId: number,
        playlistId: string,
        contentType?: 'live' | 'movie' | 'series'
    ) => ({
        xtreamId,
        playlistId,
        contentType,
    })
);

handleWorkerRequest(
    'DB_SET_CONTENT_MEDIA_METADATA',
    (
        playlistId: string,
        contentType: 'live' | 'movie' | 'series',
        xtreamId: number,
        metadata: unknown
    ) => ({
        playlistId,
        contentType,
        xtreamId,
        metadata,
    })
);

handleWorkerRequest('DB_CLEAR_CONTENT_MEDIA_METADATA', () => ({}));

handleWorkerRequest(
    'DB_SET_EPISODE_MEDIA_METADATA',
    (
        playlistId: string,
        seriesXtreamId: number,
        episodeXtreamId: number,
        metadata: unknown,
        seasonNumber?: number | null,
        episodeNumber?: number | null
    ) => ({
        playlistId,
        seriesXtreamId,
        episodeXtreamId,
        seasonNumber,
        episodeNumber,
        metadata,
    })
);

handleWorkerRequest(
    'DB_GET_SERIES_EPISODE_MEDIA_METADATA',
    (playlistId: string, seriesXtreamId: number) => ({
        playlistId,
        seriesXtreamId,
    })
);

handleWorkerRequest('DB_CLEAR_EPISODE_MEDIA_METADATA', () => ({}));

handleWorkerRequest(
    'DB_SET_CONTENT_BACKDROP_IF_MISSING',
    (contentId: number, backdropUrl?: string) => ({
        contentId,
        backdropUrl,
    })
);

handleWorkerRequest(
    'DB_SEARCH_CONTENT',
    (
        playlistId: string,
        searchTerm: string,
        types: string[],
        excludeHidden = false
    ) => ({
        playlistId,
        searchTerm,
        types,
        excludeHidden,
    })
);

handleWorkerRequest(
    'DB_GLOBAL_SEARCH',
    (searchTerm: string, types: string[], excludeHidden = false) => ({
        searchTerm,
        types,
        excludeHidden,
    })
);
