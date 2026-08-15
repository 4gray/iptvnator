import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withHooks,
    withMethods,
    withState,
} from '@ngrx/signals';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import {
    PlaybackPositionData,
    XTREAM_DATA_SOURCE,
} from '../../data-sources/xtream-data-source.interface';

export interface PlaybackPositionsState {
    playbackPositions: Map<string, PlaybackPositionData>; // key: `${contentType}_${xtreamId}`
    seriesPositions: Map<number, PlaybackPositionData[]>; // key: seriesXtreamId
}

const initialState: PlaybackPositionsState = {
    playbackPositions: new Map(),
    seriesPositions: new Map(),
};

export function withPlaybackPositions() {
    return signalStoreFeature(
        withState(initialState),

        withMethods((store) => {
            const dataSource = inject(XTREAM_DATA_SOURCE);

            const getPositionKey = (type: string, id: number) =>
                `${type}_${id}`;

            // Latest-load-wins: a load that was superseded while its fetch
            // was in flight must not patch the store — after a playlist
            // switch the late result would overwrite the new playlist's
            // position maps with the old playlist's rows.
            let positionsLoadGeneration = 0;

            return {
                /**
                 * Get progress percentage for display (0-100)
                 */
                getProgressPercent(
                    contentXtreamId: number,
                    contentType: 'vod' | 'episode'
                ): number {
                    const key = getPositionKey(contentType, contentXtreamId);
                    const position = store.playbackPositions().get(key);

                    if (!position || !position.durationSeconds) return 0;

                    const percent =
                        (position.positionSeconds / position.durationSeconds) *
                        100;

                    // If watched > 10s but percent < 1, return 1 to show visual progress
                    if (position.positionSeconds > 10 && percent < 1) {
                        return 1;
                    }

                    return Math.min(100, Math.round(percent));
                },

                /**
                 * Check if content is considered "watched" (>90% complete)
                 */
                isWatched(
                    contentXtreamId: number,
                    contentType: 'vod' | 'episode'
                ): boolean {
                    return (
                        this.getProgressPercent(contentXtreamId, contentType) >=
                        90
                    );
                },

                /**
                 * Check if content is "in progress" (started but not finished)
                 */
                isInProgress(
                    contentXtreamId: number,
                    contentType: 'vod' | 'episode'
                ): boolean {
                    const key = getPositionKey(contentType, contentXtreamId);
                    const position = store.playbackPositions().get(key);
                    if (!position) return false;

                    const percent = this.getProgressPercent(
                        contentXtreamId,
                        contentType
                    );
                    const inProgress =
                        position.positionSeconds > 10 && percent < 90;
                    return inProgress;
                },

                /**
                 * Load all playback positions for the playlist (for grid view)
                 */
                async loadAllPositions(playlistId: string): Promise<void> {
                    const generation = ++positionsLoadGeneration;
                    const positions =
                        await dataSource.getAllPlaybackPositions(playlistId);
                    if (generation !== positionsLoadGeneration) {
                        return;
                    }

                    const positionsMap = new Map<
                        string,
                        PlaybackPositionData
                    >();
                    const seriesMap = new Map<number, PlaybackPositionData[]>();

                    positions.forEach((pos) => {
                        const key = getPositionKey(
                            pos.contentType,
                            pos.contentXtreamId
                        );
                        positionsMap.set(key, pos);

                        if (
                            pos.contentType === 'episode' &&
                            pos.seriesXtreamId
                        ) {
                            const existing =
                                seriesMap.get(pos.seriesXtreamId) || [];
                            existing.push(pos);
                            seriesMap.set(pos.seriesXtreamId, existing);
                        }
                    });

                    patchState(store, {
                        playbackPositions: positionsMap,
                        seriesPositions: seriesMap,
                    });
                },

                /**
                 * Check if a series has any started or watched episodes
                 */
                hasSeriesProgress(seriesXtreamId: number): boolean {
                    const positions = store
                        .seriesPositions()
                        .get(seriesXtreamId);
                    return positions !== undefined && positions.length > 0;
                },

                /**
                 * Load positions for a VOD item
                 */
                async loadVodPosition(
                    playlistId: string,
                    vodXtreamId: number
                ): Promise<void> {
                    const position = await dataSource.getPlaybackPosition(
                        playlistId,
                        vodXtreamId,
                        'vod'
                    );

                    if (position) {
                        const key = getPositionKey('vod', vodXtreamId);
                        const updated = new Map(store.playbackPositions());
                        updated.set(key, position);
                        patchState(store, { playbackPositions: updated });
                    }
                },

                /**
                 * Load all episode positions for a series
                 */
                async loadSeriesPositions(
                    playlistId: string,
                    seriesXtreamId: number
                ): Promise<void> {
                    const positions =
                        await dataSource.getSeriesPlaybackPositions(
                            playlistId,
                            seriesXtreamId
                        );

                    const updated = new Map(store.seriesPositions());
                    updated.set(seriesXtreamId, positions);
                    patchState(store, { seriesPositions: updated });

                    // Also populate individual positions map
                    const positionsMap = new Map(store.playbackPositions());
                    positions.forEach((pos) => {
                        const key = getPositionKey(
                            'episode',
                            pos.contentXtreamId
                        );
                        positionsMap.set(key, pos);
                    });
                    patchState(store, { playbackPositions: positionsMap });
                },

                /**
                 * Save playback position (called from MPV updates)
                 */
                async savePosition(
                    playlistId: string,
                    data: PlaybackPositionData
                ): Promise<void> {
                    await dataSource.savePlaybackPosition(playlistId, data);

                    const key = getPositionKey(
                        data.contentType,
                        data.contentXtreamId
                    );
                    const updated = new Map(store.playbackPositions());
                    updated.set(key, data);
                    patchState(store, { playbackPositions: updated });
                },
            };
        }),

        withHooks((store) => {
            const playbackPositionBridge = inject(
                PlaybackPositionRuntimeBridgeService
            );
            let unsubscribe: (() => void) | undefined;

            return {
                onInit() {
                    unsubscribe =
                        playbackPositionBridge.onPlaybackPositionUpdate(
                            (data: PlaybackPositionData) => {
                                if (!data.playlistId) {
                                    return;
                                }

                                store.savePosition(data.playlistId, data);
                            }
                        );
                },
                onDestroy() {
                    unsubscribe?.();
                },
            };
        })
    );
}
