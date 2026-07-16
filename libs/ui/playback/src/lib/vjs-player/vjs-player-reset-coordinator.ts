import type { VideoJsPlayer } from './vjs-player.types';

type ResetPlayer = Pick<VideoJsPlayer, 'pause' | 'paused' | 'reset' | 'volume'>;

export interface VjsPlayerResetCoordinatorConfig {
    player: () => ResetPlayer;
    fallbackVolume: () => number;
    queueTask: (callback: () => void) => void;
    reportError: (error: unknown) => void;
}

export class VjsPlayerResetCoordinator {
    private requested = false;
    private inFlight = false;
    private sourceApplied = false;
    private volumeSnapshot: number | null = null;
    private destroyed = false;

    constructor(private readonly config: VjsPlayerResetCoordinatorConfig) {}

    requestReset(): void {
        if (this.destroyed || this.requested || this.inFlight) {
            return;
        }
        this.requested = true;

        this.captureVolume();
        try {
            this.config.player().pause();
        } catch {
            // The pause event/current paused state below remains authoritative.
        }
        if (this.isPlayerPaused()) {
            this.performReset();
            return;
        }

        this.config.queueTask(() => {
            if (this.requested && !this.inFlight && this.isPlayerPaused()) {
                this.performReset();
            }
        });
    }

    handlePause(): void {
        if (this.requested && !this.inFlight) {
            this.performReset();
        }
    }

    cancelPendingReset(): boolean {
        this.requested = false;
        if (!this.inFlight) {
            this.volumeSnapshot = null;
        }
        return this.inFlight;
    }

    handlePlayerReset(): number {
        this.requested = false;
        this.inFlight = false;
        this.sourceApplied = false;
        const volume = this.volumeSnapshot ?? this.readFallbackVolume();
        this.volumeSnapshot = null;
        return volume;
    }

    shouldSuppressVolumeChange(): boolean {
        return this.inFlight;
    }

    canApplyReadySource(): boolean {
        return !this.requested && !this.inFlight && !this.sourceApplied;
    }

    clearSourceApplied(): void {
        this.sourceApplied = false;
    }

    markSourceApplied(): void {
        this.sourceApplied = true;
    }

    destroy(): void {
        this.destroyed = true;
        this.requested = false;
        this.inFlight = false;
        this.sourceApplied = false;
        this.volumeSnapshot = null;
    }

    private performReset(): void {
        if (
            this.destroyed ||
            !this.requested ||
            this.inFlight ||
            !this.isPlayerPaused()
        ) {
            return;
        }

        this.requested = false;
        this.inFlight = true;
        try {
            this.config.player().reset();
        } catch (error: unknown) {
            this.inFlight = false;
            this.volumeSnapshot = null;
            this.config.reportError(error);
        }
    }

    private captureVolume(): void {
        if (this.volumeSnapshot !== null) {
            return;
        }
        try {
            const volume = this.config.player().volume();
            if (typeof volume === 'number' && Number.isFinite(volume)) {
                this.volumeSnapshot = Math.max(0, Math.min(1, volume));
                return;
            }
        } catch {
            // Fall through to the validated parent fallback.
        }
        this.volumeSnapshot = this.readFallbackVolume();
    }

    private readFallbackVolume(): number {
        const volume = this.config.fallbackVolume();
        return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
    }

    private isPlayerPaused(): boolean {
        try {
            return this.config.player().paused() !== false;
        } catch {
            return false;
        }
    }
}
