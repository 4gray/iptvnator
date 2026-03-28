/**
 * Category IPC event handlers
 * Operations for managing categories within playlists
 */

import { handleWorkerRequest } from './worker-events.utils';

handleWorkerRequest(
    'DB_HAS_CATEGORIES',
    (playlistId: string, type: 'live' | 'movies' | 'series') => ({
        playlistId,
        type,
    })
);

handleWorkerRequest(
    'DB_GET_CATEGORIES',
    (playlistId: string, type: 'live' | 'movies' | 'series') => ({
        playlistId,
        type,
    })
);

handleWorkerRequest(
    'DB_SAVE_CATEGORIES',
    (
        playlistId: string,
        categories: Array<{
            category_name: string;
            category_id: number;
        }>,
        type: 'live' | 'movies' | 'series',
        hiddenCategoryXtreamIds?: number[]
    ) => ({
        playlistId,
        categories,
        type,
        hiddenCategoryXtreamIds,
    })
);

handleWorkerRequest(
    'DB_UPDATE_CATEGORY_VISIBILITY',
    (categoryIds: number[], hidden: boolean) => ({
        categoryIds,
        hidden,
    })
);

handleWorkerRequest(
    'DB_GET_ALL_CATEGORIES',
    (playlistId: string, type: 'live' | 'movies' | 'series') => ({
        playlistId,
        type,
    })
);
