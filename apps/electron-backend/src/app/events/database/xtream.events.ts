/**
 * Xtream-specific IPC event handlers
 * Operations for refreshing and managing Xtream playlist data
 */

import { ipcMain } from 'electron';
import { requestWorkerWithEvents } from './worker-events.utils';

ipcMain.handle(
    'DB_DELETE_XTREAM_CONTENT',
    async (
        event,
        playlistId: string,
        operationId?: string,
        contentTypes?: import('@iptvnator/shared/interfaces').XtreamContentType[]
    ) => {
        try {
            return await requestWorkerWithEvents(
                event,
                'DB_DELETE_XTREAM_CONTENT',
                {
                    playlistId,
                    operationId,
                    contentTypes,
                }
            );
        } catch (error) {
            console.error('Error handling DB_DELETE_XTREAM_CONTENT:', error);
            throw error;
        }
    }
);

ipcMain.handle(
    'DB_RESTORE_XTREAM_USER_DATA',
    async (
        event,
        playlistId: string,
        favorites: unknown[],
        recentlyViewed: unknown[],
        operationId?: string
    ) => {
        try {
            return await requestWorkerWithEvents(
                event,
                'DB_RESTORE_XTREAM_USER_DATA',
                {
                    playlistId,
                    favorites,
                    recentlyViewed,
                    operationId,
                }
            );
        } catch (error) {
            console.error('Error handling DB_RESTORE_XTREAM_USER_DATA:', error);
            throw error;
        }
    }
);
