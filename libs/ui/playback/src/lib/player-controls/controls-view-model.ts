import { Signal, computed } from '@angular/core';
import { formatTime, volumeIcon } from './controls-format.utils';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
} from './player-controls.model';

export interface ControlsViewModelDeps {
    state: Signal<PlayerControlsState>;
    capabilities: Signal<PlayerControlsCapabilities>;
    volume: Signal<number>;
    isFullscreen: Signal<boolean>;
    canFullscreenNative: () => boolean;
    showControls: Signal<boolean>;
    /** Whether the auto-hide layer currently wants the bar visible. */
    autoHideVisible: Signal<boolean>;
    anyMenuOpen: Signal<boolean>;
}

/**
 * Pure, framework-light bundle of the controls' derived presentation signals.
 * Keeps the component lean: it derives status flags, track availability,
 * recording status text, and the volume/fullscreen labels straight from the
 * controller state + capabilities. The component still owns the auto-hide
 * visibility (which depends on transient state) and binds these by name.
 */
export function createControlsViewModel(deps: ControlsViewModelDeps) {
    const { state, capabilities, volume, isFullscreen } = deps;

    const isLoading = computed(() => state().status === 'loading');
    const isPaused = computed(() => {
        const status = state().status;
        return status === 'paused' || status === 'idle' || status === 'ended';
    });
    const isPlaying = computed(() => state().status === 'playing');

    const hasAudioTracks = computed(
        () => capabilities().audioTracks && state().audioTracks.length > 1
    );
    const hasSubtitleTracks = computed(
        () => capabilities().subtitles && state().subtitleTracks.length > 0
    );
    const canRecord = computed(
        () =>
            capabilities().recording &&
            state().isLive &&
            state().status !== 'error'
    );
    const isRecording = computed(() => state().recording.active);
    const recordingStatusText = computed(() => {
        if (!capabilities().recording) {
            return '';
        }
        const recording = state().recording;
        if (recording.active) {
            return `REC ${formatTime(recording.elapsedSeconds)}`;
        }
        return recording.message;
    });

    const volumeIconName = computed(() => volumeIcon(volume()));
    const canFullscreen = computed(
        () => capabilities().fullscreen && deps.canFullscreenNative()
    );

    const controlsAreVisible = computed(() => {
        if (!deps.showControls()) {
            return false;
        }
        return (
            deps.autoHideVisible() ||
            isLoading() ||
            isPaused() ||
            deps.anyMenuOpen() ||
            Boolean(state().statusMessage)
        );
    });
    const hideCursor = computed(
        () => isFullscreen() && isPlaying() && !controlsAreVisible()
    );

    return {
        isLoading,
        isPaused,
        isPlaying,
        hasAudioTracks,
        hasSubtitleTracks,
        canRecord,
        isRecording,
        recordingStatusText,
        volumeIcon: volumeIconName,
        canFullscreen,
        controlsAreVisible,
        hideCursor,
    };
}
