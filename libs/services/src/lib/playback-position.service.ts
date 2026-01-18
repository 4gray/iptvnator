import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root',
})
export class PlaybackPositionService {
    async savePlaybackPosition(playlistId: string, data: any): Promise<void> {
        try {
            await window.electron.dbSavePlaybackPosition(playlistId, data);
        } catch (error) {
            console.error('Error saving playback position:', error);
        }
    }

    async getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<any | null> {
        try {
            return await window.electron.dbGetPlaybackPosition(
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
    ): Promise<any[]> {
        try {
            return await window.electron.dbGetSeriesPlaybackPositions(
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
    ): Promise<any[]> {
        try {
            return await window.electron.dbGetRecentPlaybackPositions(
                playlistId,
                limit
            );
        } catch (error) {
            console.error('Error getting recent playback positions:', error);
            return [];
        }
    }

    async getAllPlaybackPositions(playlistId: string): Promise<any[]> {
        try {
            return await window.electron.dbGetAllPlaybackPositions(playlistId);
        } catch (error) {
            console.error('Error getting all playback positions:', error);
            return [];
        }
    }

    async clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void> {
        try {
            await window.electron.dbClearPlaybackPosition(
                playlistId,
                contentXtreamId,
                contentType
            );
        } catch (error) {
            console.error('Error clearing playback position:', error);
        }
    }
}
