export type PlaylistRefreshPhase =
    | 'fetching'
    | 'reading-file'
    | 'parsing'
    | 'saving';

export type PlaylistRefreshStatus =
    | 'started'
    | 'progress'
    | 'completed'
    | 'cancelled'
    | 'error';

export interface PlaylistRefreshEvent {
    operationId: string;
    playlistId: string;
    phase?: PlaylistRefreshPhase;
    status: PlaylistRefreshStatus;
    error?: string;
}

export interface PlaylistRefreshPayload {
    operationId: string;
    playlistId: string;
    title: string;
    filePath?: string;
    url?: string;
    userAgent?: string;
    trustedInsecureTlsHosts?: string[];
}

export const PLAYLIST_REFRESH_CANCELLED_RESULT_TYPE =
    'playlist-refresh-cancelled' as const;

export interface PlaylistRefreshCancelledResult {
    operationId: string;
    type: typeof PLAYLIST_REFRESH_CANCELLED_RESULT_TYPE;
}

export function isPlaylistRefreshCancelledResult(
    value: unknown
): value is PlaylistRefreshCancelledResult {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
        candidate['type'] === PLAYLIST_REFRESH_CANCELLED_RESULT_TYPE &&
        typeof candidate['operationId'] === 'string'
    );
}
