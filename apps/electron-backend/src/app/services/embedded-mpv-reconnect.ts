import type {
    EmbeddedMpvReconnectInfo,
    EmbeddedMpvSessionStatus,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';

/**
 * Automatic reconnect for embedded MPV sessions.
 *
 * The native engines report a dropped IPTV connection as an mpv error, or as
 * EOF when the server simply closed the socket. Either leaves the viewer on a
 * dead player, so the main process reloads the last user-requested playback
 * with capped exponential backoff. The policy is deliberately narrow:
 *
 * - Only a load that already reached `playing` is retried. A URL that never
 *   worked (404, refused credentials, unsupported container) keeps the manual
 *   Retry; hammering a panel six times with the same bad request helps nobody.
 * - EOF counts as a loss only for live playback — a broadcast never ends on
 *   its own, a movie does.
 * - The attempt budget belongs to one outage: it resets after
 *   {@link EMBEDDED_MPV_RECONNECT_STABLE_PLAYBACK_MS} of uninterrupted playing,
 *   not on the first `playing`, so a stream that flaps every few seconds runs
 *   out of attempts instead of being retried forever.
 * - A user-driven load, a pause, or teardown cancels everything.
 *
 * Status transitions arrive from `EmbeddedMpvNativeService.refreshSession()`
 * (polled every 500 ms); every engine flips to `loading` synchronously on a
 * load, so a failed attempt is always observed as `loading` → loss and never
 * as loss → loss. The coordinator publishes {@link EmbeddedMpvReconnectInfo}
 * for the renderer, which displays it and never schedules anything itself.
 */

export const EMBEDDED_MPV_RECONNECT_MAX_ATTEMPTS = 6;
export const EMBEDDED_MPV_RECONNECT_BASE_DELAY_MS = 2_000;
export const EMBEDDED_MPV_RECONNECT_MAX_DELAY_MS = 30_000;
export const EMBEDDED_MPV_RECONNECT_STABLE_PLAYBACK_MS = 30_000;

export interface EmbeddedMpvReconnectState {
    /** `Settings.embeddedMpvAutoReconnect`, captured at session creation. */
    enabled: boolean;
    /** The last playback the user asked for; what every attempt reloads. */
    playback: ResolvedPortalPlayback | null;
    /** Whether that playback reached `playing` at least once. */
    hadPlayed: boolean;
    /** Attempts spent on the current outage. */
    attempts: number;
    /** Start of the current uninterrupted `playing` stretch. */
    playingSince: number | null;
    timer: NodeJS.Timeout | null;
    /** What the renderer is shown while an attempt is scheduled or in flight. */
    pending: EmbeddedMpvReconnectInfo | null;
}

export interface EmbeddedMpvReconnectHooks {
    /** Issue the reload against the addon; may throw. */
    reload(sessionId: string, playback: ResolvedPortalPlayback): void;
    /** Re-read the session so the renderer sees the attempt; must not throw. */
    publish(sessionId: string): void;
    now?(): number;
    log?: Pick<Console, 'log' | 'warn'>;
}

export function createEmbeddedMpvReconnectState(
    enabled: boolean
): EmbeddedMpvReconnectState {
    return {
        enabled,
        playback: null,
        hadPlayed: false,
        attempts: 0,
        playingSince: null,
        timer: null,
        pending: null,
    };
}

/** Same rule as the renderer's `isLivePlayback`: explicit flag, else "no content info". */
export function isLiveEmbeddedMpvPlayback(
    playback: ResolvedPortalPlayback
): boolean {
    return typeof playback.isLive === 'boolean'
        ? playback.isLive
        : !playback.contentInfo;
}

/** 2 s, 4 s, 8 s, 16 s, 30 s, 30 s for attempts 1–6. */
export function resolveEmbeddedMpvReconnectDelayMs(
    completedAttempts: number
): number {
    return Math.min(
        EMBEDDED_MPV_RECONNECT_BASE_DELAY_MS * 2 ** completedAttempts,
        EMBEDDED_MPV_RECONNECT_MAX_DELAY_MS
    );
}

export function isEmbeddedMpvStreamLoss(
    status: EmbeddedMpvSessionStatus,
    isLive: boolean
): boolean {
    return status === 'error' || (status === 'ended' && isLive);
}

export class EmbeddedMpvReconnectCoordinator {
    private readonly now: () => number;
    private readonly log: Pick<Console, 'log' | 'warn'>;

    constructor(private readonly hooks: EmbeddedMpvReconnectHooks) {
        this.now = hooks.now ?? (() => Date.now());
        this.log = hooks.log ?? console;
    }

    /** The user (or the renderer on their behalf) asked for a playback. */
    onUserLoad(
        state: EmbeddedMpvReconnectState,
        playback: ResolvedPortalPlayback
    ): void {
        this.clearTimer(state);
        state.playback = playback;
        state.hadPlayed = false;
        state.attempts = 0;
        state.playingSince = null;
        state.pending = null;
    }

    cancel(state: EmbeddedMpvReconnectState): void {
        this.clearTimer(state);
        state.pending = null;
    }

    /**
     * Feed one observed status. Returns what the renderer should be shown
     * (`null` when nothing is pending).
     */
    observe(
        sessionId: string,
        state: EmbeddedMpvReconnectState,
        status: EmbeddedMpvSessionStatus,
        previousStatus: EmbeddedMpvSessionStatus | null
    ): EmbeddedMpvReconnectInfo | null {
        const now = this.now();

        if (status === 'playing') {
            state.hadPlayed = true;
            if (state.playingSince === null) {
                state.playingSince = now;
            } else if (
                state.attempts > 0 &&
                now - state.playingSince >=
                    EMBEDDED_MPV_RECONNECT_STABLE_PLAYBACK_MS
            ) {
                state.attempts = 0;
            }
            // Either our attempt succeeded or the stream recovered on its
            // own (ffmpeg-level reconnect) while a retry was still pending.
            this.cancel(state);
            return null;
        }

        state.playingSince = null;

        if (status === 'loading') {
            // A fresh user load, or our own attempt in flight.
            return state.pending;
        }

        const isLive =
            state.playback !== null &&
            isLiveEmbeddedMpvPlayback(state.playback);
        if (!isEmbeddedMpvStreamLoss(status, isLive)) {
            // paused/idle are user actions, closed is teardown, ended on
            // VOD is the movie finishing — none of them is an outage.
            this.cancel(state);
            return null;
        }

        if (status === previousStatus || state.timer !== null) {
            // Same loss observed again by the poll, or already scheduled.
            return state.pending;
        }

        return this.schedule(sessionId, state, now);
    }

    private schedule(
        sessionId: string,
        state: EmbeddedMpvReconnectState,
        now: number
    ): EmbeddedMpvReconnectInfo | null {
        if (!state.enabled || state.playback === null || !state.hadPlayed) {
            state.pending = null;
            return null;
        }
        if (state.attempts >= EMBEDDED_MPV_RECONNECT_MAX_ATTEMPTS) {
            this.log.warn(
                `[Embedded MPV][reconnect] session ${sessionId}: giving up after ${state.attempts} attempts`
            );
            state.pending = null;
            return null;
        }

        const delay = resolveEmbeddedMpvReconnectDelayMs(state.attempts);
        const attempt = state.attempts + 1;
        const playback = state.playback;
        state.pending = {
            attempt,
            maxAttempts: EMBEDDED_MPV_RECONNECT_MAX_ATTEMPTS,
            nextAttemptAt: new Date(now + delay).toISOString(),
        };
        this.log.log(
            `[Embedded MPV][reconnect] session ${sessionId}: stream lost, attempt ${attempt}/${EMBEDDED_MPV_RECONNECT_MAX_ATTEMPTS} in ${delay} ms`
        );
        state.timer = setTimeout(() => {
            state.timer = null;
            state.attempts = attempt;
            try {
                this.hooks.reload(sessionId, playback);
            } catch (error) {
                this.log.warn(
                    `[Embedded MPV][reconnect] session ${sessionId}: attempt ${attempt} could not start`,
                    error
                );
                // The addon refused the load outright, so no loading→loss
                // transition will ever arrive: continue the backoff here.
                this.schedule(sessionId, state, this.now());
            }
            this.hooks.publish(sessionId);
        }, delay);
        return state.pending;
    }

    private clearTimer(state: EmbeddedMpvReconnectState): void {
        if (state.timer !== null) {
            clearTimeout(state.timer);
            state.timer = null;
        }
    }
}
