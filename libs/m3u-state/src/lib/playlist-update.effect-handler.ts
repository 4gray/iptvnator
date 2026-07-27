import type { Playlist } from '@iptvnator/shared/interfaces';

interface PlaylistUpdateAction {
    operationId?: string;
    playlist: Playlist;
    playlistId: string;
}

interface PlaylistUpdater<TResult> {
    updatePlaylist: (
        playlistId: string,
        playlist: Playlist,
        operationId?: string
    ) => TResult;
}

export function persistPlaylistUpdate<TResult>(
    playlistsService: PlaylistUpdater<TResult>,
    action: PlaylistUpdateAction
): TResult {
    return playlistsService.updatePlaylist(
        action.playlistId,
        {
            ...action.playlist,
            _id: action.playlistId,
        },
        action.operationId
    );
}
