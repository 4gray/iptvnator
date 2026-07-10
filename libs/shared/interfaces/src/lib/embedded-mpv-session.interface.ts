export type EmbeddedMpvSessionStatus =
    | 'idle'
    | 'loading'
    | 'playing'
    | 'paused'
    | 'ended'
    | 'error'
    | 'closed';

export interface EmbeddedMpvBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface EmbeddedMpvCapabilities {
    subtitles: boolean;
    playbackSpeed: boolean;
    aspectOverride: boolean;
    screenshot: boolean;
    recording: boolean;
}

export type EmbeddedMpvEngine = 'native' | 'frame-copy';

export interface EmbeddedMpvSupport {
    supported: boolean;
    platform: string;
    reason?: string;
    capabilities?: EmbeddedMpvCapabilities;
    /**
     * Rendering engine the main process will use for new sessions.
     * `native` = platform video surface (NSOpenGLView/HWND/X11 wid),
     * `frame-copy` = helper process + shm ring + renderer canvas.
     */
    engine?: EmbeddedMpvEngine;
    /**
     * True when this machine could run the frame-copy engine (macOS arm64
     * with the helper binary present), regardless of whether it is active.
     * Drives the Settings toggle; switching engines requires an app restart.
     */
    frameCopyAvailable?: boolean;
}

/**
 * Where the renderer's frame pump finds the current shm frame ring of a
 * frame-copy session. A new generation is announced after every viewport
 * resize; the pump re-attaches to the new segment.
 */
export interface EmbeddedMpvFrameSource {
    shmName: string;
    width: number;
    height: number;
    generation: number;
    readerPath: string;
}

export interface EmbeddedMpvAudioTrack {
    id: number;
    title?: string;
    language?: string;
    selected: boolean;
    defaultTrack?: boolean;
    forced?: boolean;
}

export type EmbeddedMpvSubtitleTrack = EmbeddedMpvAudioTrack;

export interface EmbeddedMpvRecordingState {
    active: boolean;
    targetPath?: string;
    startedAt?: string;
    error?: string;
}

export interface EmbeddedMpvRecordingStartOptions {
    directory?: string;
    title?: string;
}

export interface EmbeddedMpvSession {
    id: string;
    title: string;
    streamUrl: string;
    status: EmbeddedMpvSessionStatus;
    positionSeconds: number;
    durationSeconds: number | null;
    volume: number;
    audioTracks: EmbeddedMpvAudioTrack[];
    selectedAudioTrackId: number | null;
    subtitleTracks: EmbeddedMpvSubtitleTrack[];
    selectedSubtitleTrackId: number | null;
    playbackSpeed: number;
    aspectOverride: string;
    recording?: EmbeddedMpvRecordingState;
    startedAt: string;
    updatedAt: string;
    error?: string;
}
