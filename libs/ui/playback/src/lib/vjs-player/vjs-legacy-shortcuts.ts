import { LegacyPlayerShortcuts } from '../player-controls';
import type { VideoJsPlayer } from './vjs-player.types';

export interface VjsLegacyShortcutOptions {
    player: () => VideoJsPlayer | null;
    hostElement: () => HTMLElement | null;
    isAvailable: () => boolean;
    isLive: () => boolean;
}

/**
 * App-level keyboard shortcuts for the vendor-chrome Video.js player: the
 * legacy configuration never enables `userActions.hotkeys`, so commands go
 * through the player API, which keeps the vendor control bar in sync.
 */
export function attachVjsLegacyShortcuts(
    options: VjsLegacyShortcutOptions
): LegacyPlayerShortcuts {
    const shortcuts = new LegacyPlayerShortcuts();
    shortcuts.attach({
        isAvailable: options.isAvailable,
        hostElement: options.hostElement,
        canSeek: () => {
            const duration = options.player()?.duration() ?? NaN;
            return (
                !options.isLive() && Number.isFinite(duration) && duration > 0
            );
        },
        canToggleFullscreen: () => options.player() !== null,
        togglePaused: () => {
            const player = options.player();
            if (!player) {
                return;
            }
            if (player.paused()) {
                void Promise.resolve(player.play()).catch(() => undefined);
            } else {
                player.pause();
            }
        },
        toggleFullscreen: () => {
            const player = options.player();
            if (!player) {
                return;
            }
            try {
                const request = player.isFullscreen()
                    ? player.exitFullscreen()
                    : player.requestFullscreen();
                void Promise.resolve(request).catch(() => undefined);
            } catch {
                // Fullscreen requests can be rejected synchronously.
            }
        },
        seekBy: (deltaSeconds) => {
            const player = options.player();
            if (!player) {
                return;
            }
            const duration = player.duration() ?? NaN;
            const target = (player.currentTime() ?? 0) + deltaSeconds;
            const upperBound = Number.isFinite(duration) ? duration : target;
            player.currentTime(Math.max(0, Math.min(target, upperBound)));
        },
        adjustVolume: (delta) => {
            const player = options.player();
            if (!player) {
                return;
            }
            const current = player.muted() ? 0 : (player.volume() ?? 0);
            const next = Math.max(0, Math.min(1, current + delta));
            player.volume(next);
            player.muted(next <= 0);
        },
        toggleMute: () => {
            const player = options.player();
            player?.muted(!player.muted());
        },
    });
    return shortcuts;
}
