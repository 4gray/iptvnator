/**
 * Playback position data for resume functionality
 */
export interface PlaybackPositionData {
    contentXtreamId: number;
    contentType: 'vod' | 'episode';
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    positionSeconds: number;
    durationSeconds?: number;
    playlistId?: string;
    updatedAt?: string;
    sessionId?: string;
    activitySessionId?: string;
    activityTitle?: string;
    activityAction?: 'mark-watched';
    activityIdentity?: import('./activity-sync/activity-sync.contract').ActivityContentIdentity;
    watched?: boolean;
}

/** A position the inline engine reports to the content owner. */
export interface PlaybackPositionUpdate {
    readonly currentTime: number;
    readonly duration: number;
    /** A verified final position from a playback handoff, saved immediately. */
    readonly checkpoint?: true;
}
