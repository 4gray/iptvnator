import type { MediaPlayerElement } from 'vidstack/elements';
import { LegacyMuteMemory, LegacyPlayerShortcuts } from '../player-controls';

export interface VidstackLegacyShortcutOptions {
    player: () => MediaPlayerElement | null;
    hostElement: () => HTMLElement | null;
    isAvailable: () => boolean;
    isLive: () => boolean;
}

const ignoreRejection = (): undefined => undefined;

/**
 * App-level keyboard shortcuts for the Vidstack default layout. Vidstack's own
 * keyboard handling is disabled (`keyDisabled`): it only fires while the
 * player has focus and would double-handle every key these handlers cover.
 * Commands go through the Vidstack player API so the layout stays in sync, and
 * seeking is gated on Vidstack's own `canSeek` (finite duration, not live).
 */
export function attachVidstackLegacyShortcuts(
    options: VidstackLegacyShortcutOptions
): LegacyPlayerShortcuts {
    const shortcuts = new LegacyPlayerShortcuts();
    const muteMemory = new LegacyMuteMemory();
    shortcuts.attach({
        isAvailable: options.isAvailable,
        hostElement: options.hostElement,
        canSeek: () =>
            !options.isLive() && options.player()?.state.canSeek === true,
        canToggleFullscreen: () =>
            options.player()?.state.canFullscreen === true,
        togglePaused: () => {
            const player = options.player();
            if (player) {
                const command = player.paused ? player.play() : player.pause();
                void command.catch(ignoreRejection);
            }
        },
        toggleFullscreen: () => {
            const player = options.player();
            if (player) {
                const command = player.state.fullscreen
                    ? player.exitFullscreen()
                    : player.enterFullscreen();
                void command.catch(ignoreRejection);
            }
        },
        seekBy: (deltaSeconds) => {
            const player = options.player();
            if (player) {
                player.currentTime = Math.max(
                    0,
                    player.currentTime + deltaSeconds
                );
            }
        },
        adjustVolume: (delta) => {
            const player = options.player();
            if (!player) {
                return;
            }
            const current = player.muted ? 0 : player.volume;
            const next = Math.max(0, Math.min(1, current + delta));
            player.volume = next;
            player.muted = next <= 0;
        },
        toggleMute: () => {
            const player = options.player();
            if (!player) {
                return;
            }
            if (player.muted) {
                player.volume = muteMemory.unmuteVolume(player.volume);
                player.muted = false;
            } else {
                muteMemory.rememberIfAudible(player.volume);
                player.muted = true;
            }
        },
    });
    return shortcuts;
}
