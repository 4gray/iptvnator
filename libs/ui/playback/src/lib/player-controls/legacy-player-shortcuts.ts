import { ControlsShortcuts } from './controls-shortcuts';

/**
 * Engine commands the vendor-chrome (shared-controls-off) web players expose
 * to the app-level keyboard shortcuts.
 */
export interface LegacyPlayerShortcutHandlers {
    isAvailable: () => boolean;
    /** Component root, used to opt out while an ancestor is `inert`. */
    hostElement: () => HTMLElement | null;
    canSeek: () => boolean;
    canToggleFullscreen: () => boolean;
    /**
     * Escape is delivered to every attached instance regardless of ownership;
     * vendor chrome owns its own overlays, so this defaults to a no-op.
     */
    onEscape?: () => void;
    togglePaused: () => void;
    toggleFullscreen: () => void;
    seekBy: (deltaSeconds: number) => void;
    adjustVolume: (delta: number) => void;
    toggleMute: () => void;
}

/**
 * Keyboard shortcuts for the vendor-chrome web players.
 *
 * `ControlsShortcuts` normally lives inside `app-player-controls`, which only
 * renders in shared-controls mode — with the preference off no instance was
 * attached, so the playback shortcuts advertised in the in-app help (Space/K,
 * F, arrow seek/volume, M) silently did nothing. This wrapper attaches the
 * same arbitration and ignore rules on behalf of the legacy players and
 * forwards the commands straight to the engine. Play/pause and volume are
 * gated only on availability: the owning component attaches after its engine
 * exists and detaches on destroy, so a mounted instance can always execute
 * them.
 */
export class LegacyPlayerShortcuts {
    private readonly shortcuts = new ControlsShortcuts();

    attach(handlers: LegacyPlayerShortcutHandlers): void {
        this.shortcuts.attach({
            isAvailable: handlers.isAvailable,
            hostElement: handlers.hostElement,
            canTogglePaused: () => true,
            canSeek: handlers.canSeek,
            canAdjustVolume: () => true,
            canToggleFullscreen: handlers.canToggleFullscreen,
            onEscape: handlers.onEscape ?? (() => undefined),
            togglePaused: handlers.togglePaused,
            toggleFullscreen: handlers.toggleFullscreen,
            seekBy: handlers.seekBy,
            adjustVolume: handlers.adjustVolume,
            toggleMute: handlers.toggleMute,
        });
    }

    detach(): void {
        this.shortcuts.detach();
    }
}

/**
 * Mute memory for the legacy engine adapters, mirroring the shared controls'
 * `ControlsVolume`: muting remembers the audible volume, and unmuting while
 * the volume sits at zero restores it (same 0.5 fallback), so M can never
 * leave the player silently "unmuted".
 */
export class LegacyMuteMemory {
    private lastAudibleVolume: number | null = null;

    rememberIfAudible(volume: number): void {
        if (Number.isFinite(volume) && volume > 0) {
            this.lastAudibleVolume = volume;
        }
    }

    unmuteVolume(currentVolume: number): number {
        if (Number.isFinite(currentVolume) && currentVolume > 0) {
            return currentVolume;
        }
        return this.lastAudibleVolume ?? 0.5;
    }
}
