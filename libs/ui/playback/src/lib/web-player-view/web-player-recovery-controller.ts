import {
    computed,
    signal,
    untracked,
    type Signal,
    type WritableSignal,
} from '@angular/core';
import {
    PlaybackDiagnosticCode,
    type PlaybackDiagnostic,
    type PlaybackFallbackRequest,
    type PlaybackRecommendationTarget,
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
import { isAmbiguousStreamUrl } from './ambiguous-stream-format.util';

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
    /** Up to five retries for PHP, extensionless and HLS live streams. */
    readonly autoRetryAttempt = signal(0);
    private autoRetryTimer: ReturnType<typeof setTimeout> | null = null;
    private retrySession: string | null = null;
    private retryStream: string | null = null;
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
            this.cancelAutoRetry();
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
        if (this.scheduleAutoRetry(issue)) {
            this.clearDiagnostic();
            return;
        }
        this.autoRetryAttempt.set(0);
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
        this.cancelAutoRetry();
        this.performRetry();
    }

    private performRetry(): void {
        if (!this.deps.recoverySession.beginRetry()) return;
        this.deps.reloadToken.update((value) => value + 1);
    }

    private scheduleAutoRetry(issue: PlaybackDiagnostic): boolean {
        const status = issue.httpStatus ?? issue.vhs?.httpStatus ?? issue.hls?.httpStatus;
        const url = this.deps.streamUrl();
        const isHls = /\.m3u8(?:[?#]|$)/i.test(url);
        const transient = status === 403 || status === 408 ||
            status === 429 || (status != null && status >= 500);
        // Explicit .m3u8 URLs retain immediate format/player fallback when
        // the media engine gives no HTTP status (often a codec/decode fault).
        // Known transient HTTP status codes, including temporary 403, may
        // instead benefit from a capped reconnection attempt. PHP and
        // extensionless sources keep their existing unknown-status retry.
        const retryableStatus = transient ||
            (status == null && isAmbiguousStreamUrl(url));
        if (!this.deps.resolvedIsLive() ||
            !(isAmbiguousStreamUrl(url) || isHls) ||
            !retryableStatus ||
            !(issue.code === PlaybackDiagnosticCode.NetworkError ||
              issue.code === PlaybackDiagnosticCode.MediaDecodeError ||
              issue.code === PlaybackDiagnosticCode.UnknownPlaybackError ||
              (status === 403 && issue.code === PlaybackDiagnosticCode.BrowserAccessError)) ||
            this.autoRetryAttempt() >= 5) return false;

        const attempt = this.autoRetryAttempt() + 1;
        const session = this.deps.playbackSessionKey();
        const stream = this.deps.streamUrl();
        this.autoRetryAttempt.set(attempt);
        if (this.autoRetryTimer !== null) clearTimeout(this.autoRetryTimer);
        this.autoRetryTimer = setTimeout(() => {
            this.autoRetryTimer = null;
            if (session !== this.deps.playbackSessionKey() ||
                stream !== this.deps.streamUrl()) {
                this.cancelAutoRetry();
                return;
            }
            this.performRetry();
        }, [1000, 2000, 4000, 8000, 12000][attempt - 1]);
        return true;
    }

    private cancelAutoRetry(): void {
        if (this.autoRetryTimer !== null) clearTimeout(this.autoRetryTimer);
        this.autoRetryTimer = null;
        this.autoRetryAttempt.set(0);
    }

    playbackStarted(): void {
        this.cancelAutoRetry();
    }

    destroy(): void {
        this.cancelAutoRetry();
    }

    syncSession(): void {
        const sessionKey = this.deps.playbackSessionKey();
        const stream = this.deps.streamUrl();
        if (this.retrySession !== sessionKey || this.retryStream !== stream) {
            this.cancelAutoRetry();
            this.retrySession = sessionKey;
            this.retryStream = stream;
        }
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
