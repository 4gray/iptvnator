import type { FavoriteLocalRequest } from '@iptvnator/shared/interfaces/favorites-sync';
import { readSourceServerConfig } from '../../services/source-server-config';
import type {
    ElectronBridgeFavoriteReorderUpdate,
    XtreamFavoriteRemovalRef,
} from '@iptvnator/shared/interfaces';
/**
 * Favorites IPC event handlers
 * Operations for managing user's favorite content
 */

import type { XtreamBackupFavoriteItem } from '@iptvnator/shared/interfaces';
import { handleWorkerRequest } from './worker-events.utils';

handleWorkerRequest(
    'DB_ADD_FAVORITE',
    (contentId: number, playlistId: string, backdropUrl?: string) => ({
        contentId,
        playlistId,
        backdropUrl,
    })
);

handleWorkerRequest(
    'DB_REMOVE_FAVORITE',
    (contentId: XtreamFavoriteRemovalRef, playlistId: string) => ({
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
    (updates: ElectronBridgeFavoriteReorderUpdate[]) => ({
        updates,
    })
);

handleWorkerRequest(
    'DB_RESTORE_XTREAM_FAVORITES',
    (
        playlistId: string,
        favorites: XtreamBackupFavoriteItem[],
        restoreId?: string
    ) => ({ playlistId, favorites, restoreId })
);

handleWorkerRequest('DB_GET_FAVORITES_FOR_BACKUP', (playlistId: string) => ({
    playlistId,
}));

handleWorkerRequest('DB_FAVORITES_LOCAL', (request: FavoriteLocalRequest) => {
    const selected = readSourceServerConfig();
    if (!selected || request?.instanceId !== selected.instanceId)
        throw new Error('Favorite profile mismatch');
    return request;
});

handleWorkerRequest(
    'DB_HISTORY_LOCAL',
    (
        request: import('@iptvnator/shared/interfaces/history-sync').HistoryLocalRequest
    ) => {
        const selected = readSourceServerConfig();
        if (!selected || request?.instanceId !== selected.instanceId)
            throw new Error('History profile mismatch');
        return request;
    }
);
