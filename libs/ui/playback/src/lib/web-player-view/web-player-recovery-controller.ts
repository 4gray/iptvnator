import {
    computed,
    signal,
    untracked,
    type Signal,
    type WritableSignal,
} from '@angular/core';
import type {
    PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    PlaybackFallbackRequest,
    PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';
import {
    VideoPlayer,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { ExternalPlaybackRecoveryCoordinator } from './external-playback-recovery-coordinator';
import type {
    PlaybackBinding,
    PlaybackRecoverySession,
} from './playback-recovery-session';
import type { WebPlayerApplicationHandoffCoordinator } from './web-player-application-handoff';
import type { WebPlayerApplicationToken } from './web-player-application-state';
import { createWebPlayerRecommendations } from './web-player-recovery-policy';

export interface WebPlayerRecoveryControllerDeps {
    readonly recoverySession: PlaybackRecoverySession;
    readonly externalRecovery: ExternalPlaybackRecoveryCoordinator;
    readonly applicationHandoff: WebPlayerApplicationHandoffCoordinator;
    readonly playbackSessionKey: Signal<string>;
    readonly playback: Signal<ResolvedPortalPlayback | null>;
    readonly streamUrl: Signal<string>;
    readonly startTime: Signal<number>;
    readonly selectedPlayer: Signal<VideoPlayer>;
    readonly reloadToken: WritableSignal<number>;
    readonly playbackApplicationToken: Signal<WebPlayerApplicationToken>;
    readonly resolvedPlayback: Signal<ResolvedPortalPlayback>;
    readonly resolvedIsLive: Signal<boolean>;
    readonly playbackExternallyTransferable: Signal<boolean>;
    readonly alternativeSourceCount: () => number;
    readonly managedExternalPlayersAvailable: () => boolean;
    readonly tryAutoLiveFormat?: (issue: PlaybackDiagnostic) => boolean;
    readonly emitPlaybackFailed: (code: PlaybackDiagnosticCode) => void;
    readonly emitExternalFallbackRequested: (
        request: PlaybackFallbackRequest
    ) => void;
}

/**
 * Owns the web player view's diagnostic/recovery surface: diagnostic
 * ownership, recommended-player switching, retry, and session sync. The
 * component remains the template-facing facade and delegates here.
 */
export class WebPlayerRecoveryController {
    readonly playbackDiagnostic = signal<PlaybackDiagnostic | null>(null);
    // Diagnostic ownership follows raw intent so an old action disappears;
    // the application effect then clears its backing state before handoff.
    // Keep this token opaque: it must never retain playback payload fields.
    readonly diagnosticIntentToken = computed<WebPlayerApplicationToken>(() => {
        if (this.deps.playback() === null) {
            void this.deps.streamUrl();
            void this.deps.startTime();
        }
        void this.deps.selectedPlayer();
        void this.deps.reloadToken();
        return Symbol();
    });
    private readonly diagnosticOwnerToken =
        signal<WebPlayerApplicationToken | null>(null);
    readonly visiblePlaybackDiagnostic = computed(() =>
        this.deps.selectedPlayer() === VideoPlayer.EmbeddedMpv ||
        this.diagnosticOwnerToken() !== this.diagnosticIntentToken()
            ? null
            : this.playbackDiagnostic()
    );
    readonly recommendations = computed(() => {
        const binding = this.deps.recoverySession.activeBinding();
        const token = this.deps.playbackApplicationToken();
        return createWebPlayerRecommendations({
            diagnostic: this.visiblePlaybackDiagnostic(),
            binding:
                binding && this.deps.applicationHandoff.owns(binding, token)
                    ? binding
                    : null,
            attemptedTargets: this.deps.recoverySession.attemptedTargets(),
            externalStates: this.deps.externalRecovery.states(),
            managedExternalPlayersAvailable:
                this.deps.managedExternalPlayersAvailable(),
            playbackExternallyTransferable:
                this.deps.playbackExternallyTransferable(),
            isLive: this.deps.resolvedIsLive(),
            alternativeSourceCount: this.deps.alternativeSourceCount(),
        });
    });

    constructor(private readonly deps: WebPlayerRecoveryControllerDeps) {}

    handlePlaybackIssue(
        issue: PlaybackDiagnostic | null,
        binding: PlaybackBinding
    ): void {
        const { recoverySession, applicationHandoff } = this.deps;
        this.syncSession();
        if (!recoverySession.accepts(binding)) {
            return;
        }
        if (
            !applicationHandoff.owns(
                binding,
                this.deps.playbackApplicationToken()
            )
        ) {
            applicationHandoff.invalidate();
            recoverySession.clearPlaybackBinding();
            this.clearDiagnostic();
            return;
        }
        if (!issue) {
            recoverySession.settle(binding);
            this.clearDiagnostic();
            return;
        }
        if (this.deps.tryAutoLiveFormat?.(issue)) {
            applicationHandoff.invalidate();
            recoverySession.clearPlaybackBinding();
            this.clearDiagnostic();
            return;
        }
        if (!recoverySession.recordFailure(binding)) {
            return;
        }
        this.diagnosticOwnerToken.set(this.diagnosticIntentToken());
        this.playbackDiagnostic.set(issue);
        this.deps.emitPlaybackFailed(issue.code);
    }

    requestRecommendedPlayer(target: PlaybackRecommendationTarget): void {
        const { recoverySession, externalRecovery } = this.deps;
        const diagnostic = this.visiblePlaybackDiagnostic();
        if (!diagnostic) {
            return;
        }
        const available = this.recommendations().some(
            (item) => item.action === 'player' && item.target === target
        );
        if (!available) {
            if (target !== 'mpv' && target !== 'vlc') {
                recoverySession.recordInlineAttempt(target);
            }
            return;
        }
        if (target === 'mpv' || target === 'vlc') {
            externalRecovery.request(
                target,
                () => recoverySession.recordExternalAttempt(target),
                (trackLaunch) => {
                    if (this.visiblePlaybackDiagnostic() !== diagnostic) {
                        return false;
                    }
                    this.deps.emitExternalFallbackRequested({
                        player: target,
                        playback: this.deps.resolvedPlayback(),
                        diagnostic,
                        trackLaunch,
                    });
                    return true;
                }
            );
            return;
        }
        recoverySession.beginPlayerSwitch(target, this.deps.resolvedIsLive());
    }

    retryPlayback(): void {
        if (!this.deps.recoverySession.beginRetry()) {
            return;
        }
        this.deps.reloadToken.update((value) => value + 1);
    }

    syncSession(): void {
        const sessionKey = this.deps.playbackSessionKey();
        this.deps.externalRecovery.syncSession(sessionKey);
        if (
            untracked(() => this.deps.recoverySession.syncSession(sessionKey))
        ) {
            this.clearDiagnostic();
        }
    }

    clearDiagnostic(): void {
        this.diagnosticOwnerToken.set(null);
        this.playbackDiagnostic.set(null);
    }
}
