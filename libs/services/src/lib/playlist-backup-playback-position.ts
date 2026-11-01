import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

export function isBackupPlaybackPosition(
    value: unknown
): value is PlaybackPositionData {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const position = value as Partial<PlaybackPositionData>;
    return (
        Number.isFinite(position.contentXtreamId) &&
        (position.contentType === 'vod' ||
            position.contentType === 'episode') &&
        Number.isFinite(position.positionSeconds)
    );
}

export function isStalkerBackupPosition(
    value: unknown
): value is PlaybackPositionData {
    return (
        isBackupPlaybackPosition(value) &&
        (value.watched === undefined || typeof value.watched === 'boolean') &&
        (value.durationSeconds === undefined ||
            Number.isFinite(value.durationSeconds))
    );
}

/** Restore is a local snapshot, without live player commands or session ownership. */
export function localBackupPosition(
    position: PlaybackPositionData,
    playlistId: string
): PlaybackPositionData {
    const local = { ...position, playlistId };
    delete local.activitySessionId;
    delete local.activityAction;
    if (local.watched) {
        const duration =
            typeof local.durationSeconds === 'number' &&
            Number.isFinite(local.durationSeconds) &&
            local.durationSeconds > 0
                ? local.durationSeconds
                : 1;
        local.positionSeconds = duration;
        local.durationSeconds = duration;
    }
    return local;
}
