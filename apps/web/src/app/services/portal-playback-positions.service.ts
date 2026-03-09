import { Injectable, inject } from '@angular/core';
import {
    PORTAL_PLAYBACK_POSITIONS,
    PortalPlaybackPositions,
} from '@iptvnator/portal/shared/util';
import {
    PlaybackPositionData,
    XTREAM_DATA_SOURCE,
} from '@iptvnator/portal/xtream/data-access';

@Injectable({
    providedIn: 'root',
})
export class AppPortalPlaybackPositionsService
    implements PortalPlaybackPositions
{
    private readonly dataSource = inject(XTREAM_DATA_SOURCE);

    async savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void> {
        await this.dataSource.savePlaybackPosition(playlistId, data);
    }

    async getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null> {
        return this.dataSource.getPlaybackPosition(
            playlistId,
            contentXtreamId,
            contentType
        );
    }

    async getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]> {
        return this.dataSource.getSeriesPlaybackPositions(
            playlistId,
            seriesXtreamId
        );
    }

    async getAllPlaybackPositions(
        playlistId: string
    ): Promise<PlaybackPositionData[]> {
        return this.dataSource.getAllPlaybackPositions(playlistId);
    }

    async clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void> {
        await this.dataSource.clearPlaybackPosition(
            playlistId,
            contentXtreamId,
            contentType
        );
    }
}

export const providePortalPlaybackPositions = () => [
    {
        provide: PORTAL_PLAYBACK_POSITIONS,
        useExisting: AppPortalPlaybackPositionsService,
    },
];
