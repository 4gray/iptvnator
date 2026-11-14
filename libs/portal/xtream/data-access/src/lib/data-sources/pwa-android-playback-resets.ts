import {
    type UserDataStorage,
    XTREAM_USER_DATA_KEYS,
} from '@iptvnator/services';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

type PositionId = Pick<PlaybackPositionData, 'contentType' | 'contentXtreamId'>;

export const playbackPositionsStorageKey =
    XTREAM_USER_DATA_KEYS.playbackPositions;
export const nativePlaybackResetKey = '__iptvnator_native_playback_resets__';
export type Positions = Record<string, PlaybackPositionData[]> & {
    [nativePlaybackResetKey]?: Record<string, number>;
};

export const nativePlaybackResetId = (playlistId: string, item: PositionId) =>
    JSON.stringify([playlistId, item.contentType, item.contentXtreamId]);

export function readPlaybackPositions(storage: UserDataStorage): Positions {
    const raw = storage.getItem(playbackPositionsStorageKey);
    try {
        return raw ? (JSON.parse(raw) ?? {}) : {};
    } catch {
        return {};
    }
}

export function androidPlaybackResetAt(
    storage: UserDataStorage,
    playlistId: string,
    item: PositionId
): number {
    return (
        readPlaybackPositions(storage)[nativePlaybackResetKey]?.[
            nativePlaybackResetId(playlistId, item)
        ] ?? 0
    );
}
