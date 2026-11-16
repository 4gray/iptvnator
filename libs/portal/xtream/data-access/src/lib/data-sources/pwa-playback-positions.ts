import { playbackTimestamp } from '@iptvnator/shared/interfaces';
import {
    writeXtreamUserDataMap,
    type UserDataStorage,
} from '@iptvnator/services';
import {
    nativePlaybackMayHaveCheckpoint,
    stampNativePlaybackReset,
} from '@iptvnator/services/pwa-native-playback-resets';
import type {
    PlaybackPositionData,
    PlaybackPositionResetScope,
} from '@iptvnator/shared/interfaces';
import {
    nativePlaybackResetIn,
    nativePlaybackResetId,
    stampNativePlaybackEpisodeResets,
} from './pwa-android-playback-resets';
import {
    type Positions,
    readPlaybackPositions,
    playbackPositionsStorageKey,
} from './pwa-playback-position-storage';

/** Loaded on demand. Every mutation reads fresh storage after loading the module. */
export class PwaPlaybackPositions {
    constructor(private readonly storage: UserDataStorage) {}

    private getPlaybackPositionsFromStorage(): Positions {
        try {
            return readPlaybackPositions(this.storage);
        } catch {
            return {};
        }
    }

    private savePlaybackPositionsToStorage(positions: Positions): void {
        writeXtreamUserDataMap(
            this.storage,
            playbackPositionsStorageKey,
            positions
        );
    }

    async savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void> {
        const { nativeCheckpointAt, nativeCheckpointSeasonGroup, ...position } =
            data;
        const allPositions = nativeCheckpointAt
            ? readPlaybackPositions(this.storage)
            : this.getPlaybackPositionsFromStorage();
        const prior = allPositions[playlistId] ?? [];
        const sameItem = (row: PlaybackPositionData) =>
            row.contentXtreamId === data.contentXtreamId &&
            row.contentType === data.contentType;
        if (nativeCheckpointAt) {
            const at = Date.parse(nativeCheckpointAt);
            const latest = prior.find(sameItem);
            const latestUpdate = playbackTimestamp(latest?.updatedAt);
            if (
                latestUpdate >= at ||
                nativePlaybackResetIn(allPositions, playlistId, data) >= at
            )
                return;
        }
        allPositions[playlistId] = [
            ...prior.filter((row) => !sameItem(row)),
            {
                ...position,
                updatedAt:
                    nativeCheckpointAt ??
                    (position.activityPlayedAt
                        ? position.updatedAt
                        : undefined) ??
                    new Date().toISOString(),
            },
        ];
        void nativeCheckpointSeasonGroup;

        this.savePlaybackPositionsToStorage(allPositions);
    }

    async getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        return (
            playlistPositions.find(
                (p) =>
                    p.contentXtreamId === contentXtreamId &&
                    p.contentType === contentType
            ) || null
        );
    }

    async getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        return playlistPositions.filter(
            (p) =>
                p.contentType === 'episode' &&
                p.seriesXtreamId === seriesXtreamId
        );
    }

    async getRecentPlaybackPositions(
        playlistId: string,
        limit?: number
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        // Sort by updatedAt descending
        playlistPositions.sort(
            (a, b) =>
                new Date(b.updatedAt ?? 0).getTime() -
                new Date(a.updatedAt ?? 0).getTime()
        );

        return limit ? playlistPositions.slice(0, limit) : playlistPositions;
    }

    async getAllPlaybackPositions(
        playlistId: string
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        return allPositions[playlistId] || [];
    }

    async clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void> {
        await this.clearPlaybackPositionsBatch(playlistId, [
            { contentXtreamId, contentType },
        ]);
    }

    async savePlaybackPositionsBatch(
        playlistId: string,
        items: PlaybackPositionData[]
    ): Promise<void> {
        if (items.length === 0) {
            return;
        }

        // One blob read + one write for the whole batch — the blob holds
        // every playlist's positions, so per-item saves would re-serialize
        // it N times.
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] ?? [];
        const updatedAt = new Date().toISOString();

        const replacedKeys = new Set(
            items.map((item) => `${item.contentType}_${item.contentXtreamId}`)
        );
        allPositions[playlistId] = [
            ...playlistPositions.filter(
                (p) =>
                    !replacedKeys.has(`${p.contentType}_${p.contentXtreamId}`)
            ),
            ...items.map((item) => ({
                ...item,
                updatedAt:
                    (item.activityPlayedAt ? item.updatedAt : undefined) ??
                    updatedAt,
            })),
        ];

        this.savePlaybackPositionsToStorage(allPositions);
    }

    async clearPlaybackPositionsBatch(
        playlistId: string,
        items: { contentXtreamId: number; contentType: 'vod' | 'episode' }[],
        scope?: PlaybackPositionResetScope
    ): Promise<void> {
        if (items.length === 0) {
            return;
        }

        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId];
        const android = nativePlaybackMayHaveCheckpoint();
        if (!playlistPositions && !android) return;
        if (playlistPositions) {
            const removedKeys = new Set(
                items.map(
                    (item) => `${item.contentType}_${item.contentXtreamId}`
                )
            );
            allPositions[playlistId] = playlistPositions.filter(
                (position) =>
                    !removedKeys.has(
                        `${position.contentType}_${position.contentXtreamId}`
                    )
            );
        }
        if (android) {
            if (scope)
                stampNativePlaybackEpisodeResets(
                    allPositions,
                    playlistId,
                    items
                        .filter((item) => item.contentType === 'episode')
                        .map((item) => item.contentXtreamId)
                );
            stampNativePlaybackReset(
                allPositions,
                ...items
                    .filter((item) => !scope || item.contentType !== 'episode')
                    .map((item) => nativePlaybackResetId(playlistId, item))
            );
        }
        this.savePlaybackPositionsToStorage(allPositions);
    }
}
