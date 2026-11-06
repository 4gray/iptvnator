/**
 * Playback Position IPC event handlers
 * Operations for managing video playback progress
 */

import { handleWorkerRequest } from './worker-events.utils';
import { readSourceServerConfig } from '../../services/source-server-config';
import type { ActivityLocalRequest } from '@iptvnator/shared/interfaces/activity-sync';

handleWorkerRequest('DB_ACTIVITY_LOCAL', (request: ActivityLocalRequest) => {
    const selected = readSourceServerConfig();
    if (!selected || request?.instanceId !== selected.instanceId)
        throw new Error('Activity profile mismatch');
    return request;
});

handleWorkerRequest(
    'DB_SAVE_PLAYBACK_POSITION',
    (playlistId: string, data: unknown) => ({
        playlistId,
        data,
    })
);

handleWorkerRequest(
    'DB_GET_PLAYBACK_POSITION',
    (
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ) => ({
        playlistId,
        contentXtreamId,
        contentType,
    })
);

handleWorkerRequest(
    'DB_GET_SERIES_PLAYBACK_POSITIONS',
    (playlistId: string, seriesXtreamId: number) => ({
        playlistId,
        seriesXtreamId,
    })
);

handleWorkerRequest(
    'DB_GET_RECENT_PLAYBACK_POSITIONS',
    (playlistId: string, limit?: number) => ({
        playlistId,
        limit,
    })
);

handleWorkerRequest('DB_GET_ALL_PLAYBACK_POSITIONS', (playlistId: string) => ({
    playlistId,
}));

handleWorkerRequest(
    'DB_CLEAR_ALL_PLAYBACK_POSITIONS',
    (playlistId: string) => ({
        playlistId,
    })
);

handleWorkerRequest(
    'DB_CLEAR_PLAYBACK_POSITION',
    (
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ) => ({
        playlistId,
        contentXtreamId,
        contentType,
    })
);

handleWorkerRequest(
    'DB_SAVE_PLAYBACK_POSITIONS_BATCH',
    (playlistId: string, items: unknown[]) => ({
        playlistId,
        items,
    })
);

handleWorkerRequest(
    'DB_CLEAR_PLAYBACK_POSITIONS_BATCH',
    (
        playlistId: string,
        items: { contentXtreamId: number; contentType: 'vod' | 'episode' }[]
    ) => ({
        playlistId,
        items,
    })
);

handleWorkerRequest(
    'DB_REPLACE_ALL_PLAYBACK_POSITIONS',
    (playlistId: string, items: unknown[]) => ({ playlistId, items })
);
