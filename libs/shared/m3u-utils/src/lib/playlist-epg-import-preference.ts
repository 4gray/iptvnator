import type { Playlist } from '@iptvnator/shared/interfaces';
import { resolvePlaylistEpgSourceState } from './playlist.utils';

/** Import-time opt-out keeps discovered links for later explicit enabling. */
export function applyPlaylistEpgImportPreference(
    playlist: Playlist,
    autoImportEpg = true
): Playlist {
    if (autoImportEpg) return playlist;
    return {
        ...playlist,
        autoImportEpg: false,
        ...resolvePlaylistEpgSourceState({
            autoImportEpg: false,
            detectedEpgUrls: playlist.detectedEpgUrls,
            enabledEpgUrls: playlist.epgUrls,
            manualEpgUrls: playlist.manualEpgUrls,
            disabledEpgUrls: playlist.disabledEpgUrls,
        }),
    };
}
