import { normalizeBackupPosition } from './playlist-backup-playback-position';
import type {
    PlaybackPositionData,
    XtreamPlaylistBackupEntry,
    StalkerPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';

/** An export-only view; restores and pending snapshots retain their local owner. */
export type BackupPositionProjector = (
    sourceId: string,
    local: PlaybackPositionData[]
) => Promise<PlaybackPositionData[]>;

export async function projectBackupPositions<
    T extends XtreamPlaylistBackupEntry | StalkerPlaylistBackupEntry,
>(entry: T, projector?: BackupPositionProjector): Promise<T> {
    if (!projector && !entry.userState.playbackPositions) return entry;
    const positions = projector
        ? await projector(
              entry.exportedId!,
              entry.userState.playbackPositions ?? []
          )
        : (entry.userState.playbackPositions ?? []);
    return {
        ...entry,
        userState: {
            ...entry.userState,
            playbackPositions: positions.map(normalizeBackupPosition),
        },
    };
}
