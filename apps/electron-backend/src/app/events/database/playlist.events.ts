/**
 * Playlist IPC event handlers
 * CRUD operations for playlists
 */

import { ipcMain } from 'electron';
import { databaseWorkerClient } from '../../services/database-worker-client';
import {
    handleWorkerRequest,
    requestWorkerWithEvents,
} from './worker-events.utils';

handleWorkerRequest('DB_CREATE_PLAYLIST', (playlist: Record<string, unknown>) => playlist);
handleWorkerRequest(
    'DB_UPSERT_APP_PLAYLIST',
    (playlist: Record<string, unknown>) => playlist
);
handleWorkerRequest(
    'DB_UPSERT_APP_PLAYLISTS',
    (playlists: Record<string, unknown>[]) => playlists
);
handleWorkerRequest('DB_GET_APP_PLAYLISTS', () => ({}));
handleWorkerRequest('DB_GET_APP_PLAYLIST', (playlistId: string) => ({ playlistId }));
handleWorkerRequest('DB_GET_PLAYLIST', (playlistId: string) => ({ playlistId }));
handleWorkerRequest(
    'DB_UPDATE_PLAYLIST',
    (
        playlistId: string,
        updates: {
            name?: string;
            username?: string;
            password?: string;
            serverUrl?: string;
            lastUpdated?: string;
        }
    ) => ({
        playlistId,
        updates,
    })
);
handleWorkerRequest('DB_GET_APP_STATE', (key: string) => ({ key }));
handleWorkerRequest('DB_SET_APP_STATE', (key: string, value: string) => ({
    key,
    value,
}));

ipcMain.handle(
    'DB_DELETE_PLAYLIST',
    async (
        event,
        playlistId: string,
        operationId?: string
    ) => {
        try {
            return await requestWorkerWithEvents(
                event,
                'DB_DELETE_PLAYLIST',
                {
                    playlistId,
                    operationId,
                }
            );
        } catch (error) {
            console.error('Error handling DB_DELETE_PLAYLIST:', error);
            throw error;
        }
    }
);

ipcMain.handle(
    'DB_DELETE_ALL_PLAYLISTS',
    async (event, operationId?: string) => {
        try {
            return await requestWorkerWithEvents(
                event,
                'DB_DELETE_ALL_PLAYLISTS',
                { operationId }
            );
        } catch (error) {
            console.error('Error handling DB_DELETE_ALL_PLAYLISTS:', error);
            throw error;
        }
    }
);

ipcMain.handle('DB_CANCEL_OPERATION', async (_event, operationId: string) => {
    try {
        return await databaseWorkerClient.cancel(operationId);
    } catch (error) {
        console.error('Error handling DB_CANCEL_OPERATION:', error);
        throw error;
    }
});
