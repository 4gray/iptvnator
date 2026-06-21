import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { filterPlaylistEpgUrlsForFetch } from '@iptvnator/shared/m3u-utils';

export interface PlaylistScopedEpgFetchPlan {
    key: string;
    shouldFetch: boolean;
    urls: string[];
}

export function resolvePlaylistScopedEpgFetchPlan(
    playlist: Pick<PlaylistMeta, 'epgUrls' | 'macAddress' | 'serverUrl'>,
    globalEpgUrls: readonly string[],
    previousKey = ''
): PlaylistScopedEpgFetchPlan {
    if (playlist.serverUrl || playlist.macAddress) {
        return { key: '', shouldFetch: false, urls: [] };
    }

    if (
        !Object.prototype.hasOwnProperty.call(playlist, 'epgUrls') &&
        previousKey.length > 0
    ) {
        return { key: previousKey, shouldFetch: false, urls: [] };
    }

    const urls = filterPlaylistEpgUrlsForFetch(playlist.epgUrls, globalEpgUrls);
    const key = urls.join('\n');

    return {
        key,
        shouldFetch: urls.length > 0 && key !== previousKey,
        urls,
    };
}
