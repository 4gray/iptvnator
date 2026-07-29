/**
 * VOD multi-source IPC event handlers
 * Cross-playlist movie discovery plus the per-movie pinned source.
 */

import type { VodSourcePin } from '@iptvnator/shared/interfaces';
import type { FindTitleSourcesRequest } from '../../database/operations/title-sources.operations';
import { handleWorkerRequest } from './worker-events.utils';

handleWorkerRequest(
    'DB_FIND_TITLE_SOURCES',
    (request: FindTitleSourcesRequest) => ({ request })
);

handleWorkerRequest('DB_GET_VOD_SOURCE_PIN', (matchKeys: string[]) => ({
    matchKeys,
}));

handleWorkerRequest('DB_LIST_VOD_SOURCE_PINS', (playlistId: string) => ({
    playlistId,
}));

handleWorkerRequest(
    'DB_CLEAR_VOD_SOURCE_PINS_FOR_PLAYLIST',
    (playlistId: string) => ({ playlistId })
);

handleWorkerRequest(
    'DB_SET_VOD_SOURCE_PIN',
    (
        pin: VodSourcePin,
        retireKeys: string[] = [],
        aliasKeys: string[] = []
    ) => ({
        pin,
        retireKeys,
        aliasKeys,
    })
);

handleWorkerRequest('DB_CLEAR_VOD_SOURCE_PIN', (matchKeys: string[]) => ({
    matchKeys,
}));
