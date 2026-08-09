import { LegacyMuteMemory, LegacyPlayerShortcuts } from '../player-controls';
import {
    applyVideoCurrentTime,
    applyVideoVolume,
} from '../player-controls/web-video-controls.media-helpers';

export interface HtmlVideoLegacyShortcutOptions {
    video: () => HTMLVideoElement;
    hostElement: () => HTMLElement | null;
    isAvailable: () => boolean;
    isLive: () => boolean;
    /** Play through the component's session so diagnostics stay owned there. */
    play: () => void;
}

/**
 * App-level keyboard shortcuts for the vendor-chrome HTML5 player: commands
 * act on the native video element, matching what its built-in controls do.
 */
export function attachHtmlVideoLegacyShortcuts(
    options: HtmlVideoLegacyShortcutOptions
): LegacyPlayerShortcuts {
    const shortcuts = new LegacyPlayerShortcuts();
    const muteMemory = new LegacyMuteMemory();
    shortcuts.attach({
        isAvailable: options.isAvailable,
        hostElement: options.hostElement,
        canSeek: () => {
            const duration = options.video().duration;
            return (
                !options.isLive() && Number.isFinite(duration) && duration > 0
            );
        },
        canToggleFullscreen: () =>
            typeof options.video().requestFullscreen === 'function',
        togglePaused: () => {
            const video = options.video();
            if (video.paused) {
                options.play();
            } else {
                video.pause();
            }
        },
        toggleFullscreen: () => toggleVideoElementFullscreen(options.video()),
        seekBy: (deltaSeconds) => {
            const video = options.video();
            applyVideoCurrentTime(
                video,
                video.currentTime + deltaSeconds,
                () => video.duration
            );
        },
        adjustVolume: (delta) => {
            const video = options.video();
            applyVideoVolume(video, (video.muted ? 0 : video.volume) + delta);
        },
        toggleMute: () => {
            const video = options.video();
            if (video.muted) {
                applyVideoVolume(video, muteMemory.unmuteVolume(video.volume));
            } else {
                muteMemory.rememberIfAudible(video.volume);
                video.muted = true;
            }
        },
    });
    return shortcuts;
}

/**
 * Fullscreens the video element itself, matching what the native controls'
 * own fullscreen button does for this player.
 */
function toggleVideoElementFullscreen(video: HTMLVideoElement): void {
    if (document.fullscreenElement) {
        if (
            document.fullscreenElement === video &&
            typeof document.exitFullscreen === 'function'
        ) {
            void Promise.resolve(document.exitFullscreen()).catch(
                () => undefined
            );
        }
        return;
    }
    try {
        void Promise.resolve(video.requestFullscreen()).catch(() => undefined);
    } catch {
        // Fullscreen requests can be rejected synchronously.
    }
}
