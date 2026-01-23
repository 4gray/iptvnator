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
}
