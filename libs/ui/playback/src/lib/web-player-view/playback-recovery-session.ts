import { signal, type Signal } from '@angular/core';
import type {
    InlinePlaybackPlayer,
    PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';
import type { ExternalPlayerName } from '@iptvnator/shared/interfaces';

export interface PlaybackBinding {
    readonly generation: number;
    readonly target: InlinePlaybackPlayer;
}

export class PlaybackRecoverySession {
    private readonly attemptedTargetsState = signal<
        ReadonlySet<PlaybackRecommendationTarget>
    >(new Set());
    private readonly temporaryPlayerOverrideState =
        signal<InlinePlaybackPlayer | null>(null);
    private readonly switchPendingState = signal(false);
    private readonly activeBindingState = signal<PlaybackBinding | null>(null);
    private readonly sessionKey = signal<string | null>(null);
    private readonly generation = signal(0);
    private readonly resumePosition = signal<number | null>(null);

    public readonly attemptedTargets: Signal<
        ReadonlySet<PlaybackRecommendationTarget>
    > = this.attemptedTargetsState.asReadonly();
    public readonly temporaryPlayerOverride: Signal<InlinePlaybackPlayer | null> =
        this.temporaryPlayerOverrideState.asReadonly();
    public readonly switchPending: Signal<boolean> =
        this.switchPendingState.asReadonly();
    public readonly activeBinding: Signal<PlaybackBinding | null> =
        this.activeBindingState.asReadonly();

    syncSession(key: string): boolean {
        if (this.sessionKey() === key) {
            return false;
        }

        this.sessionKey.set(key);
        this.attemptedTargetsState.set(new Set());
        this.temporaryPlayerOverrideState.set(null);
        this.switchPendingState.set(false);
        this.resumePosition.set(null);
        this.activeBindingState.set(null);
        this.generation.update((generation) => generation + 1);
        return true;
    }

    beginPlayback(target: InlinePlaybackPlayer): PlaybackBinding {
        const generation = this.generation() + 1;
        const binding: PlaybackBinding = Object.freeze({
            generation,
            target,
        });
        this.generation.set(generation);
        this.activeBindingState.set(binding);
        return binding;
    }

    clearPlaybackBinding(): void {
        this.invalidatePlaybackBinding();
    }

    endPlayback(): void {
        this.switchPendingState.set(false);
        this.invalidatePlaybackBinding();
    }

    recordFailure(binding: PlaybackBinding): boolean {
        if (!this.accepts(binding)) {
            return false;
        }

        this.recordAttempt(binding.target);
        this.switchPendingState.set(false);
        return true;
    }

    recordInlineAttempt(target: InlinePlaybackPlayer): void {
        this.recordAttempt(target);
    }

    recordExternalAttempt(target: ExternalPlayerName): void {
        this.recordAttempt(target);
    }

    recordTimeUpdate(
        event: { readonly currentTime: number; readonly duration: number },
        isLive: boolean
    ): void {
        if (
            !isLive &&
            Number.isFinite(event.currentTime) &&
            event.currentTime >= 0
        ) {
            this.resumePosition.set(event.currentTime);
        }
    }

    beginPlayerSwitch(target: InlinePlaybackPlayer, isLive: boolean): boolean {
        if (this.switchPendingState()) {
            return false;
        }

        this.recordInlineAttempt(target);
        if (isLive) {
            this.resumePosition.set(null);
        }
        this.temporaryPlayerOverrideState.set(target);
        this.switchPendingState.set(true);
        this.invalidatePlaybackBinding();
        return true;
    }

    beginRetry(): boolean {
        if (this.switchPendingState() || this.activeBindingState() === null) {
            return false;
        }

        this.switchPendingState.set(true);
        this.invalidatePlaybackBinding();
        return true;
    }

    settle(binding: PlaybackBinding): void {
        if (this.accepts(binding)) {
            this.switchPendingState.set(false);
        }
    }

    resumeStartTime(inputStartTime: number, isLive: boolean): number {
        if (isLive) {
            return 0;
        }

        const position = this.resumePosition();
        return position !== null && Number.isFinite(position) && position >= 0
            ? position
            : inputStartTime;
    }

    accepts(binding: PlaybackBinding): boolean {
        const activeBinding = this.activeBindingState();
        return (
            activeBinding !== null &&
            activeBinding.generation === binding.generation &&
            activeBinding.target === binding.target
        );
    }

    private recordAttempt(target: PlaybackRecommendationTarget): void {
        const attempts = new Set(this.attemptedTargetsState());
        attempts.add(target);
        this.attemptedTargetsState.set(attempts);
    }

    private invalidatePlaybackBinding(): void {
        this.generation.update((generation) => generation + 1);
        this.activeBindingState.set(null);
    }
}
