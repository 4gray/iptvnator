import type { Playlist } from '@iptvnator/shared/interfaces';

// Enumerable symbols survive object spreads in renderer mutations, but never
// JSON/structured-clone persistence, backups or source-definition requests.
export const READ_SNAPSHOT = Symbol('source-row-read-snapshot');
export type SnapshotPlaylist = Playlist & {
    [READ_SNAPSHOT]?: { version: string; playlist: Playlist['playlist'] };
};

export function stripSourceRowSnapshot(row: Playlist): Playlist {
    const result: SnapshotPlaylist = { ...row };
    delete result[READ_SNAPSHOT];
    return result;
}

export function inheritSourceRowSnapshot(
    current: Playlist | undefined,
    next: Playlist
): Playlist {
    const result = stripSourceRowSnapshot(next) as SnapshotPlaylist;
    const snapshot = (current as SnapshotPlaylist | undefined)?.[READ_SNAPSHOT];
    if (snapshot !== undefined) result[READ_SNAPSHOT] = snapshot;
    return result;
}
