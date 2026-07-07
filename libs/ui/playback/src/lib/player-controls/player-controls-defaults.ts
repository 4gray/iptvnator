import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
    PlayerPreset,
} from './player-controls.model';

export const DEFAULT_PLAYER_CAPABILITIES: PlayerControlsCapabilities = {
    seek: false,
    volume: false,
    audioTracks: false,
    subtitles: false,
    playbackSpeed: false,
    aspectRatio: false,
    recording: false,
    fullscreen: false,
    seriesNavigation: false,
};

export const DEFAULT_SPEED_PRESETS: ReadonlyArray<PlayerPreset<number>> = [
    { value: 0.5, label: '0.5×' },
    { value: 0.75, label: '0.75×' },
    { value: 1, label: '1×' },
    { value: 1.25, label: '1.25×' },
    { value: 1.5, label: '1.5×' },
    { value: 2, label: '2×' },
];

export const DEFAULT_ASPECT_PRESETS: ReadonlyArray<PlayerPreset<string>> = [
    { value: 'no', label: 'Default' },
    { value: '16:9', label: '16:9' },
    { value: '4:3', label: '4:3' },
    { value: '21:9', label: '21:9' },
    { value: '2.35:1', label: '2.35:1' },
];

export function createEmptyControlsState(): PlayerControlsState {
    return {
        status: 'idle',
        statusMessage: '',
        stalled: false,
        positionSeconds: 0,
        durationSeconds: null,
        isLive: false,
        canSeek: false,
        volume: 1,
        audioTracks: [],
        subtitleTracks: [],
        subtitlesEnabled: false,
        playbackSpeed: 1,
        speedPresets: DEFAULT_SPEED_PRESETS,
        aspectRatio: 'no',
        aspectPresets: DEFAULT_ASPECT_PRESETS,
        recording: { active: false, elapsedSeconds: 0, message: null },
        canPreviousEpisode: false,
        canNextEpisode: false,
    };
}
