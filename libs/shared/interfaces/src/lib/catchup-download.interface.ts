/** Provider-clock instants in seconds; independent of the viewer's EPG offset. */
export interface CatchupDownloadMetadata {
    channelName: string;
    startTimestamp: number;
    stopTimestamp: number;
    /** Last known archive availability; absent when the provider gives no window. */
    expiresAt?: number;
}

export type DownloadContentType = 'vod' | 'episode' | 'catchup';

/** Manual recovery is required before a captured unrelated file can be released. */
export interface DownloadRecoveryResult {
    success: boolean;
    error?: string;
    recoveryPath?: string;
}
