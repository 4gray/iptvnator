import { InjectionToken } from '@angular/core';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';

export interface PortalPlaybackPositions {
    savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void>;
    getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null>;
    getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]>;
    getAllPlaybackPositions(playlistId: string): Promise<PlaybackPositionData[]>;
    clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void>;
}

export const PORTAL_PLAYBACK_POSITIONS =
    new InjectionToken<PortalPlaybackPositions>('PORTAL_PLAYBACK_POSITIONS');

export function getPortalPlaybackProgressPercent(
    position: PlaybackPositionData | null | undefined
): number {
    if (!position || !position.durationSeconds) {
        return 0;
    }

    const percent = (position.positionSeconds / position.durationSeconds) * 100;

    if (position.positionSeconds > 10 && percent < 1) {
        return 1;
    }

    return Math.min(100, Math.round(percent));
}

export function isPortalPlaybackWatched(
    position: PlaybackPositionData | null | undefined
): boolean {
    return getPortalPlaybackProgressPercent(position) >= 90;
}

export function isPortalPlaybackInProgress(
    position: PlaybackPositionData | null | undefined
): boolean {
    if (!position) {
        return false;
    }

    const percent = getPortalPlaybackProgressPercent(position);
    return position.positionSeconds > 10 && percent < 90;
}
