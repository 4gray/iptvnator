import type Artplayer from 'artplayer';
import { LegacyMuteMemory, LegacyPlayerShortcuts } from '../player-controls';

export interface ArtPlayerLegacyShortcutOptions {
    player: () => Artplayer | null;
    hostElement: () => HTMLElement | null;
    isAvailable: () => boolean;
    isLive: () => boolean;
}

/**
 * App-level keyboard shortcuts for the vendor-chrome ArtPlayer. ArtPlayer's
 * own `hotkey` option is disabled in the legacy chrome (it only fired while
 * the player was focused and does not honor `defaultPrevented`, so keeping it
 * would double-handle every key); these handlers go through the same ArtPlayer
 * setters its hotkeys used, so vendor notices and UI stay in sync. Seeking is
 * gated on `art.duration` — the same value ArtPlayer's seek setter clamps
 * against — so a stream with unknown duration never jumps to zero.
 */
export function attachArtPlayerLegacyShortcuts(
    options: ArtPlayerLegacyShortcutOptions
): LegacyPlayerShortcuts {
    const shortcuts = new LegacyPlayerShortcuts();
    const muteMemory = new LegacyMuteMemory();
    shortcuts.attach({
        isAvailable: options.isAvailable,
        hostElement: options.hostElement,
        canSeek: () => {
            const duration = options.player()?.duration ?? NaN;
            return (
                !options.isLive() && Number.isFinite(duration) && duration > 0
            );
        },
        canToggleFullscreen: () => options.player() !== null,
        onEscape: () => {
            // Restores the vendor hotkey behavior the disabled `hotkey`
            // option used to provide.
            const player = options.player();
            if (player?.fullscreenWeb) {
                player.fullscreenWeb = false;
            }
        },
        togglePaused: () => {
            options.player()?.toggle();
        },
        toggleFullscreen: () => {
            const player = options.player();
            if (player) {
                player.fullscreen = !player.fullscreen;
            }
        },
        seekBy: (deltaSeconds) => {
            const player = options.player();
            if (!player) {
                return;
            }
            if (deltaSeconds >= 0) {
                player.forward = deltaSeconds;
            } else {
                player.backward = -deltaSeconds;
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
