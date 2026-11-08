import {
    isStalkerAccountPlaylist,
    type PlaylistMeta,
} from '@iptvnator/shared/interfaces';

export function isWorkspaceGlobalSearchablePlaylist(
    playlist: PlaylistMeta
): boolean {
    if (playlist.serverUrl) {
        return true;
    }

    if (playlist.macAddress) {
        return isStalkerAccountPlaylist(playlist);
    }

    return Boolean(
        playlist.filePath || playlist.url || Number(playlist.count ?? 0) > 0
    );
}
