import {
    DestroyRef,
    effect,
    inject,
    Injectable,
    Injector,
    untracked,
} from '@angular/core';
import type { LiveChannelFailoverService } from '@iptvnator/playback/data-access';
import {
    LIVE_FAILOVER_ATTEMPT_MS,
    LIVE_FAILOVER_MAX_RETRIES,
    type ElectronBridgePlayerError,
    type ExternalPlayerErrorCode,
    type ExternalPlayerSession,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { ExternalPlaybackService } from './external-playback.service';
import { PlayerService } from './player.service';
import { SettingsStore } from './settings-store.service';

/**
 * Failures that mean the stream cannot be played as sent. `previous-closing`
 * is a race with our own replacement launch, not a bad channel.
 */
const FAILED_CODES: ReadonlySet<ExternalPlayerErrorCode> =
    new Set<ExternalPlayerErrorCode>([
        'start-failed',
        'closed-unexpectedly',
        'stream-open-failed',
        'unsupported-protocol',
        'connection-failed',
        'access-denied',
        'stream-not-found',
        'timed-out',
    ]);

/**
 * Live channel failover for managed external MPV/VLC.
 *
 * The app sees only what the main process reports: session updates and
 * `player-error` output. A launch that fails, a stream-open error, or the
 * process exiting unexpectedly spends one of the same three retries the
 * embedded player uses; each retry replays the exact launch, headers
 * included, through {@link PlayerService}. Once the retries are spent,
 * {@link LiveChannelFailoverService} hops to the same channel in another
 * source.
 *
 * That service — and the store, database and snackbar graph behind it — is
 * imported only when a live channel actually fails, so this listener stays
 * out of the initial bundle. The settings gate is read directly instead.
 *
 * Deliberate limit: without a position feed in the renderer (only reused MPV
 * and VLC have one, inside the main process) a stream that opens and silently
 * stalls cannot be told apart from one that is merely slow, and reloading it
 * would break channels that do play. `opened` therefore only stops the launch
 * timer; `playing` is what confirms the attempt and restores the budget.
 */
@Injectable({ providedIn: 'root' })
export class ExternalLiveFailoverService {
    private readonly external = inject(ExternalPlaybackService);
    private readonly player = inject(PlayerService);
    private readonly settings = inject(SettingsStore);
    private readonly injector = inject(Injector);

    private tracked: ExternalPlayerSession | null = null;
    private playback: ResolvedPortalPlayback | null = null;
    private retries = 0;
    private phase: 'pending' | 'playing' | 'failed' | 'idle' = 'idle';
    private watchdog: ReturnType<typeof setTimeout> | null = null;
    /** Bumped when an attempt is abandoned, so its pending work bails out. */
    private attempt = 0;
    /** Resolved on the first live failure; null until then. */
    private failover: LiveChannelFailoverService | null = null;
    private failoverLoad: Promise<LiveChannelFailoverService | null> | null =
        null;

    constructor() {
        effect(() => {
            const session = this.external.activeSession();
            untracked(() => this.observe(session));
        });
        window.electron?.onPlayerError?.((data) =>
            this.handlePlayerError(data)
        );
        inject(DestroyRef).onDestroy(() => this.stop());
    }

    private observe(session: ExternalPlayerSession | null): void {
        if (!session) {
            this.tracked = null;
            this.playback = null;
            this.stop();
            return;
        }
        if (this.tracked?.id !== session.id) {
            this.trackLaunch(session);
            return;
        }
        if (!this.enabled() || !this.playback || this.phase === 'idle') {
            return;
        }
        if (session.status === 'error' || session.status === 'closed') {
            if (session.errorCode && FAILED_CODES.has(session.errorCode)) {
                this.fail(session);
            } else {
                // A normal close is not a failure: the user stopped playback,
                // so whatever this attempt was waiting on is over.
                this.stop();
            }
            return;
        }
        if (session.status === 'playing') {
            this.succeed(session);
            return;
        }
        if (session.status === 'opened') {
            // Launched, not playing yet: stop the launch timer but keep the
            // retry budget and any pending hop until playback is confirmed.
            this.clearWatchdog();
        }
    }

    private trackLaunch(session: ExternalPlayerSession): void {
        // Matched by stream and title, not by session id: a session update can
        // arrive while the launch IPC call is still in flight, before its
        // session id exists in the renderer.
        const launch = this.player.lastExternalPlayback();
        const owned =
            launch !== null &&
            launch.streamUrl === session.streamUrl &&
            launch.title === session.title
                ? launch
                : null;
        // Our own retry replays the same stream: the budget continues.
        const sameStream =
            owned !== null &&
            this.playback !== null &&
            owned.streamUrl === this.playback.streamUrl &&
            owned.title === this.playback.title;
        this.playback = owned;
        this.tracked = session;
        // A new launch owns failure handling; an older attempt's pending work
        // must not reopen anything.
        this.attempt += 1;
        // The setting is about live channels: a failed movie or episode keeps
        // its ordinary playback behaviour.
        if (!this.enabled() || !owned || owned.isLive !== true) {
            this.stop();
            return;
        }
        if (!sameStream) {
            this.retries = 0;
        }
        // Only meaningful once a hop exists, which means the service is loaded.
        this.failover?.reportLoading(session.title);
        this.phase = 'pending';
        this.startAttempt();
    }

    private succeed(session: ExternalPlayerSession): void {
        this.clearWatchdog();
        this.phase = 'playing';
        this.retries = 0;
        this.failover?.reportPlaying(session.title);
    }

    private fail(session: ExternalPlayerSession): void {
        const playback = this.playback;
        this.clearWatchdog();
        this.phase = 'failed';
        if (!this.enabled() || this.tracked?.id !== session.id) {
            this.stop();
            return;
        }
        if (!playback) {
            this.stop();
            return;
        }
        void this.finishFailure(session, playback);
    }

    private async finishFailure(
        session: ExternalPlayerSession,
        playback: ResolvedPortalPlayback
    ): Promise<void> {
        const attempt = this.attempt;
        const failover = await this.loadFailover();
        if (
            !failover ||
            attempt !== this.attempt ||
            this.tracked?.id !== session.id ||
            this.phase !== 'failed'
        ) {
            return;
        }
        if (
            failover.isHopTarget(session.title) ||
            this.retries >= LIVE_FAILOVER_MAX_RETRIES
        ) {
            this.stop();
            void failover.reportFailed(session.title);
            return;
        }
        this.retries += 1;
        failover.reportRetrying(this.retries);
        this.phase = 'pending';
        this.startAttempt();
        try {
            await this.player.openExternalPlayback(playback, session.player);
        } catch {
            const tracked = this.tracked;
            if (tracked && attempt === this.attempt) {
                this.fail(tracked);
            }
        }
    }

    private loadFailover(): Promise<LiveChannelFailoverService | null> {
        this.failoverLoad ??= import('@iptvnator/playback/data-access')
            .then((module) =>
                this.injector.get(module.LiveChannelFailoverService)
            )
            .then((failover) => {
                this.failover = failover;
                return failover;
            })
            .catch(() => null);
        return this.failoverLoad;
    }

    private handlePlayerError(data: ElectronBridgePlayerError): void {
        const session = this.tracked;
        if (
            !session ||
            // `player-error` names the player in upper case; a session uses
            // the lower-case id.
            session.player !== data.player.toLowerCase() ||
            session.status === 'closed' ||
            !data.code ||
            !FAILED_CODES.has(data.code) ||
            !this.enabled() ||
            !this.playback
        ) {
            return;
        }
        this.fail(session);
    }

    private enabled(): boolean {
        return this.settings.liveChannelFailover?.() === true;
    }

    private startAttempt(): void {
        this.clearWatchdog();
        this.watchdog = setTimeout(() => {
            this.watchdog = null;
            const session = this.tracked;
            if (this.phase === 'pending' && session) {
                this.fail(session);
            }
        }, LIVE_FAILOVER_ATTEMPT_MS);
    }

    private stop(): void {
        this.attempt += 1;
        this.clearWatchdog();
        this.phase = 'idle';
    }

    private clearWatchdog(): void {
        if (this.watchdog !== null) {
            clearTimeout(this.watchdog);
            this.watchdog = null;
        }
    }
}
