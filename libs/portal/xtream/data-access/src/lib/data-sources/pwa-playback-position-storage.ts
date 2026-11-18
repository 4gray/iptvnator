import {
    forgetXtreamRestoreReceipt,
    type UserDataStorage,
    XTREAM_USER_DATA_KEYS,
} from '@iptvnator/services';
import { stampNativePlaybackPlaylistReset } from '@iptvnator/services/pwa-native-playback-resets';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

export const playbackPositionsStorageKey =
    XTREAM_USER_DATA_KEYS.playbackPositions;
export type Positions = Record<string, PlaybackPositionData[]>;

export function readPlaybackPositions(storage: UserDataStorage): Positions {
    const raw = storage.getItem(playbackPositionsStorageKey);
    try {
        return raw ? (JSON.parse(raw) ?? {}) : {};
    } catch {
        return {};
    }
}

export function clearPlaylistPlaybackPositions(
    storage: UserDataStorage,
    playlistId: string
): void {
    const positions = readPlaybackPositions(storage);
    delete positions[playlistId];
    stampNativePlaybackPlaylistReset(positions, playlistId);
    forgetXtreamRestoreReceipt(positions, playlistId);
    storage.setItem(playbackPositionsStorageKey, JSON.stringify(positions));
}
