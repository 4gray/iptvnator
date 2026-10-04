import { InjectionToken } from '@angular/core';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';

export interface PortalPlaybackPositions {
    savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void>;
    savePlaybackPositionOrThrow(
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
    clearPlaybackPositionOrThrow(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void>;
    /**
     * Bulk variants for season-level watched toggles. Unlike the single
     * save/clear methods these REJECT on failure so callers can surface an
     * error instead of silently showing stale state.
     */
    savePlaybackPositionsBatch(
        playlistId: string,
        items: PlaybackPositionData[]
    ): Promise<void>;
    clearPlaybackPositionsBatch(
        playlistId: string,
        items: { contentXtreamId: number; contentType: 'vod' | 'episode' }[]
    ): Promise<void>;
}

export const PORTAL_PLAYBACK_POSITIONS =
    new InjectionToken<PortalPlaybackPositions>('PORTAL_PLAYBACK_POSITIONS');

/**
 * Progress at or above which a movie or episode counts as watched. The last
 * tenth is mostly end credits, so stopping there finishes the title. Plex
 * ("video played threshold"), Jellyfin and Emby ("max resume percentage")
 * and Kodi ("playcountminimumpercent") all default to the same 90%.
 */
export const PORTAL_WATCHED_PROGRESS_PERCENT = 90;

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
    return (
        getPortalPlaybackProgressPercent(position) >=
        PORTAL_WATCHED_PROGRESS_PERCENT
    );
}

export function isPortalPlaybackInProgress(
    position: PlaybackPositionData | null | undefined
): boolean {
    if (!position) {
        return false;
    }

    const percent = getPortalPlaybackProgressPercent(position);
    return (
        position.positionSeconds > 10 &&
        percent < PORTAL_WATCHED_PROGRESS_PERCENT
    );
}

/** The most recently updated row, e.g. a series' latest episode. */
export function newestPortalPlaybackPosition(
    positions: Iterable<PlaybackPositionData>
): PlaybackPositionData | null {
    let newest: PlaybackPositionData | null = null;
    for (const position of positions) {
        if (!newest || (position.updatedAt ?? '') > (newest.updatedAt ?? '')) {
            newest = position;
        }
    }
    return newest;
}
