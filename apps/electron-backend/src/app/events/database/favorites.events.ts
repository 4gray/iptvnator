/**
 * Favorites IPC event handlers
 * Operations for managing user's favorite content
 */

import { handleWorkerRequest } from './worker-events.utils';

handleWorkerRequest(
    'DB_ADD_FAVORITE',
    (contentId: number, playlistId: string) => ({
        contentId,
        playlistId,
    })
);

handleWorkerRequest(
    'DB_REMOVE_FAVORITE',
    (contentId: number, playlistId: string) => ({
        contentId,
        playlistId,
    })
);

handleWorkerRequest(
    'DB_IS_FAVORITE',
    (contentId: number, playlistId: string) => ({
        contentId,
        playlistId,
    })
);

handleWorkerRequest('DB_GET_FAVORITES', (playlistId: string) => ({
    playlistId,
}));

handleWorkerRequest('DB_GET_GLOBAL_FAVORITES', () => ({}));
handleWorkerRequest('DB_GET_ALL_GLOBAL_FAVORITES', () => ({}));

handleWorkerRequest(
    'DB_REORDER_GLOBAL_FAVORITES',
    (updates: { content_id: number; position: number }[]) => ({
        updates,
    })
);
