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
    getPortalPlaybackProgressPercent,
    isPortalPlaybackInProgress,
    PORTAL_WATCHED_PROGRESS_PERCENT,
} from '@iptvnator/portal/shared/util/tokens';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import {
    PlaybackPositionData,
    XTREAM_DATA_SOURCE,
} from '../../data-sources/xtream-data-source.interface';

export type PositionsLoadState = 'idle' | 'loading' | 'ready' | 'error';
export interface PlaybackPositionsState {
    playbackPositions: Map<string, PlaybackPositionData>;
    seriesPositions: Map<number, PlaybackPositionData[]>;
    positionsPlaylistId: string | null;
    positionsLoadState: PositionsLoadState;
}
const initialState: PlaybackPositionsState = {
    playbackPositions: new Map(),
    seriesPositions: new Map(),
    positionsPlaylistId: null,
    positionsLoadState: 'idle',
};
const positionKey = (data: PlaybackPositionData) =>
    `${data.contentType}_${data.contentXtreamId}`;

export function withPlaybackPositions() {
    return signalStoreFeature(
        withState(initialState),
        withMethods((store) => {
            const dataSource = inject(XTREAM_DATA_SOURCE);
            let ownerGeneration = 0;
            let loadGeneration = 0;
            // Full snapshots supersede narrower reads on entry and publication,
            // including successfully empty snapshots.
            let individualReadGeneration = 0;
            const revisions = new Map<string, number>();
            let pendingWrites: Map<string, PlaybackPositionData> | null = null;
            const owns = (id: string, generation: number) =>
                store.positionsPlaylistId() === id &&
                ownerGeneration === generation;
            const adoptOwner = (id: string) => {
                if (store.positionsPlaylistId() === id) return;
                ownerGeneration++;
                loadGeneration++;
                revisions.clear();
                pendingWrites = null;
                patchState(store, {
                    ...initialState,
                    playbackPositions: new Map(),
                    seriesPositions: new Map(),
                    positionsPlaylistId: id,
                });
            };
            // Standalone consumers may load/save one item before a grid batch.
            const captureOwner = (id: string) => {
                if (store.positionsPlaylistId() === null) adoptOwner(id);
                return ownerGeneration;
            };
            const publish = (positions: Map<string, PlaybackPositionData>) => {
                const series = new Map<number, PlaybackPositionData[]>();
                for (const row of positions.values()) {
                    if (row.contentType === 'episode' && row.seriesXtreamId) {
                        const rows = series.get(row.seriesXtreamId) ?? [];
                        rows.push(row);
                        series.set(row.seriesXtreamId, rows);
                    }
                }
                patchState(store, {
                    playbackPositions: positions,
                    seriesPositions: series,
                });
            };
            const publishPosition = (data: PlaybackPositionData) => {
                const key = positionKey(data);
                revisions.set(key, (revisions.get(key) ?? 0) + 1);
                const positions = new Map(store.playbackPositions());
                positions.set(key, data);
                publish(positions);
            };
            return {
                resetPlaybackPositions(): void {
                    ownerGeneration++;
                    loadGeneration++;
                    revisions.clear();
                    pendingWrites = null;
                    patchState(store, {
                        ...initialState,
                        playbackPositions: new Map(),
                        seriesPositions: new Map(),
                    });
                },
                getProgressPercent(
                    id: number,
                    type: 'vod' | 'episode'
                ): number {
                    return getPortalPlaybackProgressPercent(
                        store.playbackPositions().get(`${type}_${id}`)
                    );
                },
                isWatched(id: number, type: 'vod' | 'episode'): boolean {
                    return (
                        this.getProgressPercent(id, type) >=
                        PORTAL_WATCHED_PROGRESS_PERCENT
                    );
                },
                isInProgress(id: number, type: 'vod' | 'episode'): boolean {
                    return isPortalPlaybackInProgress(
                        store.playbackPositions().get(`${type}_${id}`)
                    );
                },
                async loadAllPositions(playlistId: string): Promise<void> {
                    adoptOwner(playlistId);
                    const owner = ownerGeneration;
                    const generation = ++loadGeneration;
                    individualReadGeneration++;
                    const writes = new Map<string, PlaybackPositionData>();
                    pendingWrites = writes;
                    patchState(store, { positionsLoadState: 'loading' });
                    try {
                        const rows =
                            await dataSource.getAllPlaybackPositions(
                                playlistId
                            );
                        if (
                            !owns(playlistId, owner) ||
                            generation !== loadGeneration
                        )
                            return;
                        const positions = new Map(
                            rows.map((row) => [positionKey(row), row])
                        );
                        for (const [key, row] of writes)
                            positions.set(key, row);
                        individualReadGeneration++;
                        publish(positions);
                        patchState(store, { positionsLoadState: 'ready' });
                    } catch (error) {
                        if (
                            owns(playlistId, owner) &&
                            generation === loadGeneration
                        )
                            patchState(store, { positionsLoadState: 'error' });
                        throw error;
                    } finally {
                        if (pendingWrites === writes) pendingWrites = null;
                    }
                },
                hasSeriesProgress(id: number): boolean {
                    return (store.seriesPositions().get(id)?.length ?? 0) > 0;
                },
                async loadVodPosition(
                    playlistId: string,
                    id: number
                ): Promise<void> {
                    const owner = captureOwner(playlistId);
                    const readGeneration = individualReadGeneration;
                    const key = `vod_${id}`;
                    const revision = revisions.get(key) ?? 0;
                    const position = await dataSource.getPlaybackPosition(
                        playlistId,
                        id,
                        'vod'
                    );
                    if (
                        !owns(playlistId, owner) ||
                        readGeneration !== individualReadGeneration ||
                        revision !== (revisions.get(key) ?? 0)
                    )
                        return;
                    if (position) publishPosition(position);
                },
                async loadSeriesPositions(
                    playlistId: string,
                    id: number
                ): Promise<void> {
                    const owner = captureOwner(playlistId);
                    const readGeneration = individualReadGeneration;
                    const before = new Map(revisions);
                    const rows = await dataSource.getSeriesPlaybackPositions(
                        playlistId,
                        id
                    );
                    if (
                        !owns(playlistId, owner) ||
                        readGeneration !== individualReadGeneration
                    )
                        return;
                    const positions = new Map(store.playbackPositions());
                    // Empty reads replace this series, preserving newer writes.
                    for (const [key, row] of positions) {
                        if (
                            row.contentType === 'episode' &&
                            row.seriesXtreamId === id &&
                            (before.get(key) ?? 0) === (revisions.get(key) ?? 0)
                        )
                            positions.delete(key);
                    }
                    for (const row of rows) {
                        const key = positionKey(row);
                        if (
                            (before.get(key) ?? 0) === (revisions.get(key) ?? 0)
                        ) {
                            positions.set(key, row);
                            revisions.set(key, (revisions.get(key) ?? 0) + 1);
                        }
                    }
                    publish(positions);
                },
                async savePosition(
                    playlistId: string,
                    data: PlaybackPositionData
                ): Promise<void> {
                    const owner = captureOwner(playlistId);
                    await dataSource.savePlaybackPosition(playlistId, data);
                    if (owns(playlistId, owner)) {
                        // Only confirmed storage writes may overlay a batch read.
                        pendingWrites?.set(positionKey(data), data);
                        publishPosition(data);
                    }
                },
            };
        }),
        withHooks((store) => {
            const bridge = inject(PlaybackPositionRuntimeBridgeService);
            const logger = createLogger('XtreamPlaybackPositions');
            let unsubscribe: (() => void) | undefined;
            return {
                onInit() {
                    unsubscribe = bridge.onPlaybackPositionUpdate((data) => {
                        // The bridge event has not been persisted yet. Save
                        // its source even when a different catalog is open;
                        // savePosition guards in-memory publication separately.
                        if (!data.playlistId) return;
                        void store
                            .savePosition(data.playlistId, data)
                            .catch((error) => {
                                logger.warn(
                                    'Failed to save playback position',
                                    error
                                );
                            });
                    });
                },
                onDestroy() {
                    unsubscribe?.();
                },
            };
        })
    );
}
