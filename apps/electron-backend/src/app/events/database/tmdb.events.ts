/**
 * TMDB metadata cache IPC event handlers
 * Persists TMDB API responses so detail-view enrichment stays offline-fast
 */

import type { TmdbCacheEntry, TmdbMediaType } from '@iptvnator/shared/interfaces';
import { handleWorkerRequest } from './worker-events.utils';

handleWorkerRequest(
    'DB_GET_TMDB_METADATA',
    (mediaType: TmdbMediaType, lookupKey: string, language: string) => ({
        mediaType,
        lookupKey,
        language,
    })
);

handleWorkerRequest('DB_SET_TMDB_METADATA', (entry: TmdbCacheEntry) => ({
    entry,
}));

handleWorkerRequest('DB_MATCH_TITLES', (titles: string[]) => ({ titles }));
