import type { Signal } from '@angular/core';

export type PlayerStatus =
    | 'idle'
    | 'loading'
    | 'playing'
    | 'paused'
    | 'ended'
    | 'error';

/** Which controls an engine supports. A control is only rendered when its flag is true. */
export interface PlayerControlsCapabilities {
    seek: boolean; // scrub bar / ±10s (VOD)
    volume: boolean;
    audioTracks: boolean;
    subtitles: boolean;
    playbackSpeed: boolean;
    aspectRatio: boolean;
    recording: boolean;
    fullscreen: boolean;
    seriesNavigation: boolean;
}

export interface PlayerTrack {
    id: number;
    label: string; // adapter pre-computes the display label
    selected: boolean;
}

export interface PlayerPreset<T> {
    value: T;
    label: string;
}

export interface PlayerRecordingState {
    active: boolean;
    /** Seconds since recording started; adapter computes via a 1s tick. */
    elapsedSeconds: number;
    /** Persistent status text (e.g. "Saved to …" / error). null when none. */
    message: string | null;
}

export interface PlayerControlsState {
    status: PlayerStatus;
    /** Loading/error text for the player surface; '' when nothing to show. */
    statusMessage: string;
    stalled: boolean;
    positionSeconds: number;
    durationSeconds: number | null;
    isLive: boolean;
    canSeek: boolean;
    volume: number; // 0..1
    audioTracks: PlayerTrack[];
    subtitleTracks: PlayerTrack[];
    /** True when a subtitle track is active (selected id !== null/off). */
    subtitlesEnabled: boolean;
    playbackSpeed: number;
    speedPresets: ReadonlyArray<PlayerPreset<number>>;
    aspectRatio: string;
    aspectPresets: ReadonlyArray<PlayerPreset<string>>;
    recording: PlayerRecordingState;
    canPreviousEpisode: boolean;
    canNextEpisode: boolean;
}

/** Imperative command surface. All fire-and-forget (void). */
export interface PlayerControlsCommands {
    togglePlay(): void;
    seekTo(seconds: number): void;
    seekBy(deltaSeconds: number): void;
    setVolume(value: number): void; // 0..1
    setAudioTrack(id: number): void;
    setSubtitleTrack(id: number): void; // -1 = off
    setPlaybackSpeed(speed: number): void;
    setAspectRatio(value: string): void;
    toggleRecording(): void;
}

/**
 * What any engine implements to drive the shared controls. Intentionally has NO
 * component-lifecycle assumptions — a controller may live above the router
 * (background-playback readiness, subissue 04). Episode navigation and
 * fullscreen are NOT here: they are controls-component outputs / DOM affordances.
 */
export interface PlayerController {
    readonly capabilities: Signal<PlayerControlsCapabilities>;
    readonly state: Signal<PlayerControlsState>;
    readonly commands: PlayerControlsCommands;
}
