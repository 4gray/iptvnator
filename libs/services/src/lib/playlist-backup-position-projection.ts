import type {
    PlaybackPositionData,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';

/** An export-only view; restores and pending snapshots retain their local owner. */
export type BackupPositionProjector = (
    sourceId: string,
    local: PlaybackPositionData[]
) => Promise<PlaybackPositionData[]>;

export async function projectXtreamBackupPositions(
    entry: XtreamPlaylistBackupEntry,
    projector?: BackupPositionProjector
): Promise<XtreamPlaylistBackupEntry> {
    if (!projector) return entry;
    return {
        ...entry,
        userState: {
            ...entry.userState,
            playbackPositions: await projector(
                entry.exportedId!,
                entry.userState.playbackPositions
            ),
        },
    };
}
