import { inject, Injectable } from '@angular/core';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { PlaybackPositionRuntimeBridgeService } from './playback-position-runtime-bridge.service';

@Injectable({
    providedIn: 'root',
})
export class PlaybackPositionService {
    private readonly playbackPositionBridge = inject(
        PlaybackPositionRuntimeBridgeService
    );

    async savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void> {
        try {
            await this.playbackPositionBridge.savePlaybackPosition(
                playlistId,
                data
            );
        } catch (error) {
            console.error('Error saving playback position:', error);
        }
    }

    async getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null> {
        try {
            return await this.playbackPositionBridge.getPlaybackPosition(
                playlistId,
                contentXtreamId,
                contentType
            );
        } catch (error) {
            console.error('Error getting playback position:', error);
            return null;
        }
    }

    async getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]> {
        try {
            return await this.playbackPositionBridge.getSeriesPlaybackPositions(
                playlistId,
                seriesXtreamId
            );
        } catch (error) {
            console.error('Error getting series playback positions:', error);
            return [];
        }
    }

    async getRecentPlaybackPositions(
        playlistId: string,
        limit?: number
    ): Promise<PlaybackPositionData[]> {
        try {
            return await this.playbackPositionBridge.getRecentPlaybackPositions(
                playlistId,
                limit
            );
        } catch (error) {
            console.error('Error getting recent playback positions:', error);
            return [];
        }
    }

    async getAllPlaybackPositions(
        playlistId: string
    ): Promise<PlaybackPositionData[]> {
        try {
            return await this.playbackPositionBridge.getAllPlaybackPositions(
                playlistId
            );
        } catch (error) {
            console.error('Error getting all playback positions:', error);
            return [];
        }
    }

    /**
     * Failure-propagating read for cache refreshes: a swallowed error would
     * surface as an authoritative empty list and let a transient IPC failure
     * wipe an already-populated position cache.
     */
    getAllPlaybackPositionsOrThrow(
        playlistId: string
    ): Promise<PlaybackPositionData[]> {
        return this.playbackPositionBridge.getAllPlaybackPositions(playlistId);
    }

    async clearAllPlaybackPositions(playlistId: string): Promise<void> {
        try {
            await this.playbackPositionBridge.clearAllPlaybackPositions(
                playlistId
            );
        } catch (error) {
            console.error('Error clearing all playback positions:', error);
        }
    }

    async clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void> {
        try {
            await this.playbackPositionBridge.clearPlaybackPosition(
                playlistId,
                contentXtreamId,
                contentType
            );
        } catch (error) {
            console.error('Error clearing playback position:', error);
        }
    }

    // The batch methods deliberately propagate failures (no swallow):
    // season-level bulk toggles must show an error and keep the UI state
    // untouched when nothing was persisted.
    savePlaybackPositionsBatch(
        playlistId: string,
        items: PlaybackPositionData[]
    ): Promise<void> {
        return this.playbackPositionBridge.savePlaybackPositionsBatch(
            playlistId,
            items
        );
    }

    clearPlaybackPositionsBatch(
        playlistId: string,
        items: { contentXtreamId: number; contentType: 'vod' | 'episode' }[]
    ): Promise<void> {
        return this.playbackPositionBridge.clearPlaybackPositionsBatch(
            playlistId,
            items
        );
    }
}
