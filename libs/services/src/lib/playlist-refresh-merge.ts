import {
    PlaylistUpdateState,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import { applySourceDefinition } from '@iptvnator/shared/interfaces/source-definition';
import {
    resolvePlaylistEpgSourceState,
    playlistRefreshMatchesSource,
    retainPlaylistRefreshSource,
} from '@iptvnator/shared/m3u-utils';
import { inheritSourceRowSnapshot } from './source-sync/source-row-snapshot-context';

/** Refresh owns parsed content; the current row owns connection and device activity. */
export function mergeRefreshedPlaylist(
    currentPlaylist: Playlist | undefined,
    updatedPlaylist: Playlist,
    playlistId: string
): Playlist {
    if (
        currentPlaylist &&
        !playlistRefreshMatchesSource(currentPlaylist, updatedPlaylist)
    )
        return currentPlaylist;
    const autoImportEpg = currentPlaylist
        ? currentPlaylist.autoImportEpg
        : updatedPlaylist.autoImportEpg;
    const epgSourceState = resolvePlaylistEpgSourceState({
        autoImportEpg,
        detectedEpgUrls:
            updatedPlaylist.detectedEpgUrls ?? currentPlaylist?.detectedEpgUrls,
        enabledEpgUrls: updatedPlaylist.epgUrls ?? currentPlaylist?.epgUrls,
        manualEpgUrls:
            updatedPlaylist.manualEpgUrls ?? currentPlaylist?.manualEpgUrls,
        disabledEpgUrls:
            updatedPlaylist.disabledEpgUrls ?? currentPlaylist?.disabledEpgUrls,
    });

    const merged = {
        ...currentPlaylist,
        ...updatedPlaylist,
        ...retainPlaylistRefreshSource(currentPlaylist),
        _id: playlistId,
        count:
            updatedPlaylist.playlist?.items?.length ??
            currentPlaylist?.count ??
            updatedPlaylist.count,
        updateDate: Date.now(),
        updateState: PlaylistUpdateState.UPDATED,
        ...(currentPlaylist
            ? {
                  favorites: currentPlaylist.favorites,
                  recentlyViewed: currentPlaylist.recentlyViewed,
                  position: currentPlaylist.position,
              }
            : {}),
        ...(autoImportEpg !== undefined ? { autoImportEpg } : {}),
        epgUrls: epgSourceState.epgUrls,
        detectedEpgUrls: epgSourceState.detectedEpgUrls,
        manualEpgUrls: epgSourceState.manualEpgUrls,
        disabledEpgUrls: epgSourceState.disabledEpgUrls,
        autoRefresh:
            currentPlaylist?.autoRefresh ?? updatedPlaylist.autoRefresh,
    };
    const accepted = currentPlaylist?.sourceSyncBase
        ? applySourceDefinition(currentPlaylist.sourceSyncBase, {
              ...merged,
              sourceSyncBase: currentPlaylist.sourceSyncBase,
              sourceSyncRevision: currentPlaylist.sourceSyncRevision,
          })
        : merged;
    return inheritSourceRowSnapshot(currentPlaylist, accepted);
}
