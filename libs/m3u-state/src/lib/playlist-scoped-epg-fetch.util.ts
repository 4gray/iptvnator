import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { filterPlaylistEpgUrlsForFetch } from '@iptvnator/shared/m3u-utils';

export interface PlaylistScopedEpgFetchPlan {
    key: string;
    shouldFetch: boolean;
    urls: string[];
}

export interface PlaylistScopedEpgFetchOptions {
    force?: boolean;
}

export function resolvePlaylistScopedEpgFetchPlan(
    playlist: Pick<PlaylistMeta, 'epgUrls' | 'macAddress' | 'serverUrl'>,
    globalEpgUrls: readonly string[],
    previousKey = '',
    options: PlaylistScopedEpgFetchOptions = {}
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
    const previousUrls = new Set(
        previousKey
            .split('\n')
            .map((url) => url.trim())
            .filter((url) => url.length > 0)
    );
    const newUrls = urls.filter((url) => !previousUrls.has(url));
    const urlsToFetch = options.force ? urls : newUrls;

    return {
        key,
        shouldFetch: urlsToFetch.length > 0,
        urls: urlsToFetch.length > 0 ? urlsToFetch : urls,
    };
}
