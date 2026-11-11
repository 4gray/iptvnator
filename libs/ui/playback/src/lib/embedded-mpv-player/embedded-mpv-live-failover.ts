import { DestroyRef, effect, inject, Signal, untracked } from '@angular/core';
import {
    LIVE_FAILOVER_ATTEMPT_MS,
    LIVE_FAILOVER_MAX_RETRIES,
    LiveChannelFailoverService,
} from '@iptvnator/playback/data-access';
import type {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';

export interface EmbeddedMpvLiveFailoverDeps {
    playback: Signal<ResolvedPortalPlayback>;
    session: Signal<EmbeddedMpvSession | null>;
    isLive: Signal<boolean>;
    isSupported: Signal<boolean>;
    /** Starts a fresh session for the same playback. */
    retry: () => void;
}

/**
 * Live stream retries for one mounted embedded MPV player, while the
 * Settings → Live channel failover toggle is on. Each attempt gets
 * {@link LIVE_FAILOVER_ATTEMPT_MS} to reach `playing`; an mpv error, a live
 * EOF, the main process's own reconnect, or the attempt running out of time
 * counts as a failure and starts the next attempt, up to
 * {@link LIVE_FAILOVER_MAX_RETRIES}. Then {@link LiveChannelFailoverService}
 * hops to the same channel in other sources. A hop's candidate gets a single
 * attempt: on failure the service moves on to the next source.
 *
 * Must be created in an injection context (a component field).
 */
export class EmbeddedMpvLiveFailover {
    private readonly failover = inject(LiveChannelFailoverService);
    /** Retries spent on the current playback. */
    private retries = 0;
    /** The current attempt's outcome, so each is reported once. */
    private phase: 'pending' | 'playing' | 'failed' | 'idle' = 'idle';
    private watchdog: ReturnType<typeof setTimeout> | null = null;
    private active = false;

    constructor(private readonly deps: EmbeddedMpvLiveFailoverDeps) {
        // Re-runs for every new playback (channel change or hop).
        effect(() => {
            deps.playback();
            const active =
                this.failover.enabled() && deps.isLive() && deps.isSupported();
            untracked(() => {
                this.active = active;
                if (active) {
                    this.restart();
                } else {
                    this.stop();
                }
            });
        });

        effect(() => {
            const session = deps.session();
            untracked(() => this.observe(session));
        });

        inject(DestroyRef).onDestroy(() => this.stop());
    }

    /** A new playback, or the user's own Retry: a fresh retry budget. */
    restart(): void {
        if (!this.active) {
            return;
        }
        this.retries = 0;
        this.failover.reportLoading(this.deps.playback().title);
        this.startAttempt();
    }

    private observe(session: EmbeddedMpvSession | null): void {
        if (this.phase !== 'pending' && this.phase !== 'playing') {
            return;
        }
        const status = session?.status ?? null;
        if (status === 'error' || status === 'ended' || session?.reconnect) {
            this.fail();
        } else if (status === 'playing' && this.phase === 'pending') {
            this.clearWatchdog();
            this.phase = 'playing';
            this.retries = 0;
            this.failover.reportPlaying(this.deps.playback().title);
        } else if (status === 'paused' || status === 'closed') {
            // The user paused, or the session is being torn down: neither
            // is a stream that failed to start.
            this.clearWatchdog();
        }
    }

    private fail(): void {
        this.clearWatchdog();
        this.phase = 'failed';
        const title = this.deps.playback().title;
        if (
            this.failover.isHopTarget(title) ||
            this.retries >= LIVE_FAILOVER_MAX_RETRIES
        ) {
            void this.failover.reportFailed(title);
            return;
        }
        this.retries += 1;
        this.failover.reportRetrying(this.retries);
        this.startAttempt();
        this.deps.retry();
    }

    private startAttempt(): void {
        this.clearWatchdog();
        this.phase = 'pending';
        this.watchdog = setTimeout(() => {
            this.watchdog = null;
            if (this.phase === 'pending') {
                this.fail();
            }
        }, LIVE_FAILOVER_ATTEMPT_MS);
    }

    private stop(): void {
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
