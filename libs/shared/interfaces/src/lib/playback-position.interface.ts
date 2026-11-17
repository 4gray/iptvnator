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
    /** Capture time used to compare positions during checkpoint recovery. */
    activityPlayedAt?: string;
    /** Original time of a delayed native checkpoint, carried through activity sync. */
    nativeCheckpointAt?: string;
    /** Provider season map key used by resets when it differs from the episode label. */
    nativeCheckpointSeasonGroup?: number;
    activityTitle?: string;
    activityAction?: 'mark-watched';
    activityIdentity?: import('./activity-sync/activity-sync.contract').ActivityContentIdentity;
    watched?: boolean;
}

/** The group explicitly cleared by a season or series action. */
export interface PlaybackPositionResetScope {
    readonly seriesXtreamId: number;
    readonly seasonNumber?: number;
}

/** A position the inline engine reports to the content owner. */
export interface PlaybackPositionUpdate {
    readonly currentTime: number;
    readonly duration: number;
    /** A verified final position from a playback handoff, saved immediately. */
    readonly checkpoint?: true;
    readonly nativeCheckpointAt?: string;
    /**
     * Whether the media was actually playing — not paused and not seeking.
     * Seeks of paused media also move the position; only playing reports
     * count towards the "really played" history confirmation. A `false`
     * report (pause, seek) also persists the position at once. Left
     * undefined by an engine that cannot tell.
     */
    readonly playing?: boolean;
}

/** A short cut can start below a requested offset it can never reach. */
export function hasReachedPlaybackStart(
    event: PlaybackPositionUpdate,
    startTime: number
): boolean {
    return (
        event.checkpoint === true ||
        (event.duration > 0 && startTime >= event.duration) ||
        !(startTime > 0 && event.currentTime < startTime - 5)
    );
}

/** SQLite writes UTC without a zone. Normalize it before comparing against ISO times. */
export function playbackTimestamp(value: string | undefined): number {
    if (!value) return 0;
    const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;
    const timestamp = Date.parse(
        sqliteUtc.test(value) ? `${value.replace(' ', 'T')}Z` : value
    );
    return Number.isFinite(timestamp) ? timestamp : 0;
}
