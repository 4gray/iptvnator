/**
 * Recently Viewed IPC event handlers
 * Operations for managing user's recently viewed content
 */

import { handleWorkerRequest } from './worker-events.utils';

// Renderer clears dormant source/profile history before these native writes.
// Persist that DOM state before acknowledging a clear without a journal.
const flushDeferredHistory = (event: Electron.IpcMainInvokeEvent): void =>
    event.sender.session.flushStorageData();

handleWorkerRequest('DB_GET_RECENTLY_VIEWED', () => ({}));
handleWorkerRequest(
    'DB_CLEAR_RECENTLY_VIEWED',
    () => ({}),
    flushDeferredHistory
);

handleWorkerRequest(
    'DB_GET_RECENT_ITEMS',
    (playlistId: string, options?: { all?: boolean }) => ({
        playlistId,
        ...(options?.all === true ? { all: true } : {}),
    })
);

handleWorkerRequest(
    'DB_ADD_RECENT_ITEM',
    (contentId: number, playlistId: string, backdropUrl?: string) => ({
        contentId,
        playlistId,
        backdropUrl,
    })
);

handleWorkerRequest(
    'DB_CLEAR_PLAYLIST_RECENT_ITEMS',
    (playlistId: string) => ({
        playlistId,
    }),
    flushDeferredHistory
);

handleWorkerRequest(
    'DB_REMOVE_RECENT_ITEM',
    (contentId: number, playlistId: string) => ({
        contentId,
        playlistId,
    })
);

handleWorkerRequest(
    'DB_REMOVE_RECENT_ITEMS_BATCH',
    (items: { contentId: number; playlistId: string }[]) => ({
        items,
    })
);
