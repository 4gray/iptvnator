import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withHooks,
    withMethods,
    withState,
} from '@ngrx/signals';
import { XtreamSerieEpisode } from 'shared-interfaces';
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

function parseDuration(duration: string | number): number {
    if (typeof duration === 'number') return duration;
    if (!duration) return 0;

    // Check for "min" format (e.g. "45 min")
    const minMatch = duration.match(/(\d+)\s*min/);
    if (minMatch) {
        return parseInt(minMatch[1], 10) * 60;
    }

    // Check for "h:m:s" or "m:s" format
    if (duration.includes(':')) {
        const parts = duration.split(':').map((p) => parseInt(p, 10));
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        }
    }

    // Fallback: try parsing as simple number (seconds or minutes? assume minutes if < 1000, seconds otherwise?)
    // Xtream usually returns seconds or "min" string
    const num = parseInt(duration, 10);
    if (!isNaN(num)) {
        return num;
    }

    return 0;
}

export function withPlaybackPositions() {
    return signalStoreFeature(
        withState(initialState),

        withMethods((store) => {
            const dataSource = inject(XTREAM_DATA_SOURCE);

            const getPositionKey = (type: string, id: number) =>
                `${type}_${id}`;

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
                        this.getProgressPercent(
                            contentXtreamId,
                            contentType
                        ) >= 90
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
                    const positions = await dataSource.getAllPlaybackPositions(
                        playlistId
                    );

                    console.log(
                        `[withPlaybackPositions] Loaded all positions (${positions.length})`
                    );

                    const positionsMap = new Map<string, PlaybackPositionData>();
                    const seriesMap = new Map<number, PlaybackPositionData[]>();

                    positions.forEach((pos) => {
                        // Populate playbackPositions map
                        const key = getPositionKey(
                            pos.contentType,
                            pos.contentXtreamId
                        );
                        positionsMap.set(key, pos);

                        // Populate seriesPositions map
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

                    console.log(
                        `[withPlaybackPositions] Series map populated: ${seriesMap.size} series`
                    );

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

                    if (positions && positions.length > 0) {
                        console.log(`[withPlaybackPositions] Series ${seriesXtreamId} HAS progress`);
                        return true;
                    }
                    // console.log(`[withPlaybackPositions] Series ${seriesXtreamId} NO progress`);
                    return false;
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

                    console.log(
                        `[withPlaybackPositions] Loaded VOD position for ${vodXtreamId}:`,
                        position
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
                    const positions = await dataSource.getSeriesPlaybackPositions(
                        playlistId,
                        seriesXtreamId
                    );

                    console.log(
                        `[withPlaybackPositions] Loaded series positions for ${seriesXtreamId}:`,
                        positions
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
                    console.log(
                        `[withPlaybackPositions] Saving position for ${key}:`,
                        data
                    );
                    const updated = new Map(store.playbackPositions());
                    updated.set(key, data);
                    patchState(store, { playbackPositions: updated });
                },

                /**
                 * Toggle watched status for an episode
                 */
                async toggleEpisodeWatched(
                    playlistId: string,
                    episode: XtreamSerieEpisode,
                    seriesId: number
                ): Promise<void> {
                    const id = Number(episode.id);
                    const isWatched = this.isWatched(id, 'episode');

                    if (isWatched) {
                        // Mark as unwatched
                        await dataSource.clearPlaybackPosition(
                            playlistId,
                            id,
                            'episode'
                        );
                        // Update state (remove from map)
                        const key = getPositionKey('episode', id);
                        const updated = new Map(store.playbackPositions());
                        updated.delete(key);

                        // Update series map
                        const seriesMap = new Map(store.seriesPositions());
                        const seriesEpisodes = seriesMap.get(seriesId) || [];
                        const filteredEpisodes = seriesEpisodes.filter(
                            (p) => p.contentXtreamId !== id
                        );
                        if (filteredEpisodes.length === 0) {
                            seriesMap.delete(seriesId);
                        } else {
                            seriesMap.set(seriesId, filteredEpisodes);
                        }

                        patchState(store, {
                            playbackPositions: updated,
                            seriesPositions: seriesMap,
                        });
                    } else {
                        // Mark as watched
                        let duration = 0;
                        const info = Array.isArray(episode.info)
                            ? null
                            : episode.info;

                        if (info?.duration_secs) {
                            duration = info.duration_secs;
                        } else if (info?.duration) {
                            duration = parseDuration(info.duration);
                        }

                        if (duration === 0) duration = 1; // Fallback

                        // Setting position = duration indicates episode is fully watched
                        const data: PlaybackPositionData = {
                            contentXtreamId: id,
                            contentType: 'episode',
                            seriesXtreamId: seriesId,
                            seasonNumber: Number(episode.season),
                            episodeNumber: Number(episode.episode_num),
                            positionSeconds: duration,
                            durationSeconds: duration,
                            playlistId,
                            updatedAt: new Date().toISOString(),
                        };

                        // Use existing savePosition to handle state update and persistence
                        // But we also need to update seriesPositions map which savePosition doesn't do for individual updates
                        // actually savePosition only updates playbackPositions map.
                        // We should probably update savePosition to also update series map, or do it here.
                        // Let's do it here to be safe.

                        await dataSource.savePlaybackPosition(playlistId, data);

                        const key = getPositionKey('episode', id);
                        const updated = new Map(store.playbackPositions());
                        updated.set(key, data);

                        const seriesMap = new Map(store.seriesPositions());
                        const seriesEpisodes = seriesMap.get(seriesId) || [];
                        // Check if already exists
                        const existingIdx = seriesEpisodes.findIndex(
                            (p) => p.contentXtreamId === id
                        );
                        if (existingIdx >= 0) {
                            seriesEpisodes[existingIdx] = data;
                        } else {
                            seriesEpisodes.push(data);
                        }
                        seriesMap.set(seriesId, seriesEpisodes);

                        patchState(store, {
                            playbackPositions: updated,
                            seriesPositions: seriesMap,
                        });
                    }
                },
            };
        }),

        withHooks({
            onInit(store) {
                if (window.electron?.onPlaybackPositionUpdate) {
                    window.electron.onPlaybackPositionUpdate((data: any) => {
                        console.log(
                            '[withPlaybackPositions] Received update:',
                            data
                        );
                        // Ensure playlistId is present
                        if (data.playlistId) {
                            store.savePosition(data.playlistId, data);
                        } else {
                            console.warn(
                                '[withPlaybackPositions] Missing playlistId in update',
                                data
                            );
                        }
                    });
                }
            },
            onDestroy(store) {
                if (window.electron?.removePlaybackPositionListener) {
                    window.electron.removePlaybackPositionListener();
                }
            },
        })
    );
}
