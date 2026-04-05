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
}
