export interface XtreamIpcMarkerCaptureOptions {
    readonly actions: readonly string[];
    readonly mainPhases: readonly string[];
    readonly methods: readonly string[];
    readonly schemaVersion: number;
}

export interface XtreamIpcRequestIdentity {
    ipcCallId: number | null;
    operationId: string | null;
    operationIdUnavailableReason: string | null;
    sourceEpochMs: number | null;
}

export interface XtreamIpcCallState {
    completionOutcome: 'error' | 'success' | null;
    downstreamMatched: boolean;
    ended: boolean;
    key: string;
    marker: import('./xtream-ipc-marker-protocol').SafeXtreamPreloadMarker;
    quarantined: boolean;
    receivedEpochMs: number;
}

export interface XtreamMainPhaseState {
    endEpochMs: number | null;
    startEpochMs: number;
}

export interface XtreamIpcTimelineRecord {
    readonly action?: string | null;
    readonly boundary: 'end' | 'start';
    readonly categoryType?: string | null;
    readonly contentType?: string | null;
    readonly durationMs?: number | null;
    readonly epochMs: number;
    readonly ipcCallId?: number;
    readonly itemCount?: number | null;
    readonly method?: string;
    readonly operationId?: string | null;
    readonly outcome?: 'error' | 'success' | null;
    readonly phase?: string;
    readonly playlistId?: string | null;
    readonly requestId?: string;
    readonly sessionId?: string | null;
    readonly sourceEpochMs?: number;
    readonly type: 'xtream-main-phase' | 'xtream-preload-marker';
}

export interface XtreamIpcMarkerCaptureSnapshot {
    readonly invalidReasons: readonly string[];
    readonly quarantinedKeyCount: number;
    readonly timeline: readonly XtreamIpcTimelineRecord[];
}

export interface XtreamIpcMarkerCapture {
    acceptMainPhase(input: unknown): boolean;
    acceptPreload(
        senderWebContentsId: number,
        receivedEpochMs: number,
        input: unknown
    ): boolean;
    matchDatabaseCancel(input: unknown): XtreamIpcRequestIdentity | null;
    matchDatabaseRequest(input: unknown): XtreamIpcRequestIdentity | null;
    start(expectedWebContentsId: number, captureStartedEpochMs: number): void;
    stop(): XtreamIpcMarkerCaptureSnapshot;
}
