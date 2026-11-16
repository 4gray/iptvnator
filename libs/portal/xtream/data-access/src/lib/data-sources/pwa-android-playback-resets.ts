import type { UserDataStorage } from '@iptvnator/services';
import {
    nativePlaybackEpisodeResetKey,
    nativePlaybackResetAt,
} from '@iptvnator/services/pwa-native-playback-resets';
import type {
    PlaybackPositionData,
    PlaybackPositionResetScope,
} from '@iptvnator/shared/interfaces';
import {
    readPlaybackPositions,
    type Positions,
} from './pwa-playback-position-storage';

type PositionId = Pick<PlaybackPositionData, 'contentType' | 'contentXtreamId'>;
type EpisodeResets = Record<string, Record<string, number>>;

export const nativePlaybackResetId = (playlistId: string, item: PositionId) =>
    JSON.stringify([playlistId, item.contentType, item.contentXtreamId]);

function nativePlaybackScopeId(
    playlistId: string,
    scope: PlaybackPositionResetScope
): string {
    return JSON.stringify(
        scope.seasonNumber === undefined
            ? [playlistId, 'series', scope.seriesXtreamId]
            : [playlistId, 'season', scope.seriesXtreamId, scope.seasonNumber]
    );
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
    return Math.max(
        nativePlaybackResetAt(positions, ...keys),
        item.contentType === 'episode'
            ? nativePlaybackEpisodeResetAt(
                  positions,
                  playlistId,
                  item.contentXtreamId
              )
            : 0
    );
}

function nativePlaybackEpisodeResetAt(
    positions: Record<string, unknown>,
    playlistId: string,
    episodeId: number
): number {
    const resets = positions[nativePlaybackEpisodeResetKey] as
        EpisodeResets | undefined;
    const batches = resets?.[playlistId];
    if (!batches) return 0;
    let latest = 0;
    for (const [key, timestamp] of Object.entries(batches)) {
        if (timestamp <= latest) continue;
        const ranges = key.split(',').map(Number);
        for (let index = 0; index < ranges.length; index += 2) {
            if (episodeId >= ranges[index] && episodeId <= ranges[index + 1]) {
                latest = timestamp;
                break;
            }
        }
    }
    return latest;
}

export function stampNativePlaybackEpisodeResets(
    positions: Record<string, unknown>,
    playlistId: string,
    episodeIds: number[]
): void {
    if (!episodeIds.length) return;
    // Adjacent IDs share one range so a bulk clear can free space at quota.
    const ranges: number[] = [];
    for (const id of [...new Set(episodeIds)].sort((a, b) => a - b)) {
        if (ranges.length && id === ranges[ranges.length - 1] + 1)
            ranges[ranges.length - 1] = id;
        else ranges.push(id, id);
    }
    const resets = positions[nativePlaybackEpisodeResetKey] as
        EpisodeResets | undefined;
    positions[nativePlaybackEpisodeResetKey] = {
        ...resets,
        [playlistId]: {
            ...resets?.[playlistId],
            [ranges.join(',')]: Date.now(),
        },
    };
}
