import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

/** Legacy playback writers encode watched state through progress, not a column. */
export function localActivityPosition(
    position: PlaybackPositionData
): PlaybackPositionData {
    const local = { ...position };
    delete local.activitySessionId;
    delete local.activityAction;
    if (local.watched) {
        const duration =
            Number.isFinite(local.durationSeconds) && local.durationSeconds! > 0
                ? local.durationSeconds!
                : 1;
        local.positionSeconds = duration;
        local.durationSeconds = duration;
    }
    return local;
}

export function isStalkerEpisode(position: PlaybackPositionData): boolean {
    return (
        position.activityIdentity?.provider === 'stalker' &&
        position.contentType === 'episode'
    );
}

export function resetPosition(
    position: PlaybackPositionData
): PlaybackPositionData {
    return {
        ...position,
        positionSeconds: 0,
        durationSeconds: undefined,
        watched: false,
    };
}
