import {
    type UserDataStorage,
    XTREAM_USER_DATA_KEYS,
} from '@iptvnator/services';
import { nativePlaybackResetAt } from '@iptvnator/services/pwa-native-playback-resets';
import type {
    PlaybackPositionData,
    PlaybackPositionResetScope,
} from '@iptvnator/shared/interfaces';

type PositionId = Pick<PlaybackPositionData, 'contentType' | 'contentXtreamId'>;

export const playbackPositionsStorageKey =
    XTREAM_USER_DATA_KEYS.playbackPositions;
export type Positions = Record<string, PlaybackPositionData[]>;

export const nativePlaybackResetId = (playlistId: string, item: PositionId) =>
    JSON.stringify([playlistId, item.contentType, item.contentXtreamId]);

export function nativePlaybackScopeId(
    playlistId: string,
    scope: PlaybackPositionResetScope
): string {
    return JSON.stringify(
        scope.seasonNumber === undefined
            ? [playlistId, 'series', scope.seriesXtreamId]
            : [playlistId, 'season', scope.seriesXtreamId, scope.seasonNumber]
    );
}

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
    item: PlaybackPositionData
): number {
    return nativePlaybackResetIn(
        readPlaybackPositions(storage),
        playlistId,
        item
    );
}

export function nativePlaybackResetIn(
    positions: Positions,
    playlistId: string,
    item: PlaybackPositionData
): number {
    const keys = [playlistId, nativePlaybackResetId(playlistId, item)];
    const seasonGroup = item.nativeCheckpointSeasonGroup ?? item.seasonNumber;
    if (item.contentType === 'episode' && item.seriesXtreamId !== undefined) {
        keys.push(
            nativePlaybackScopeId(playlistId, {
                seriesXtreamId: item.seriesXtreamId,
            })
        );
        if (seasonGroup !== undefined) {
            keys.push(
                nativePlaybackScopeId(playlistId, {
                    seriesXtreamId: item.seriesXtreamId,
                    seasonNumber: seasonGroup,
                })
            );
        }
    }
    return nativePlaybackResetAt(positions, ...keys);
}
