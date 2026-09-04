import type {
    EmbeddedMpvReconnectInfo,
    EmbeddedMpvSessionStatus,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { isEmbeddedMpvSessionGoneError } from './embedded-mpv-session-errors';

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
 * - A user-driven load, a pause, or teardown cancels everything. A pause
 *   also disarms the policy until the stream plays again: a drop while the
 *   user has the stream paused must not resume playback behind their back.
 * - An attempt is tracked explicitly from the moment its reload is issued,
 *   so a reload that fails before the poll ever sees it `loading` is still
 *   counted as a failed attempt rather than mistaken for the original loss.
 * - A VOD reload resumes at the last position observed while playing; a live
 *   reload goes back to the live edge.
 * - An `error` the engine attributes to itself (a macOS render failure, a
 *   fatal libmpv log in the helper) is not a stream loss: reloading media
 *   cannot repair a broken render context, so it stays a terminal error.
 * - A reload the engine cannot take at all (a crashed frame-copy helper,
 *   reported as `EmbeddedMpvSessionGoneError`) ends the reconnect: only a
 *   new session can recover, and the renderer's Retry creates one.
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
    /** A reload was issued and neither `playing` nor a loss has answered it yet. */
    attemptInFlight: boolean;
    /**
     * Last position reported while the stream played, seeded from the
     * playback's own `startTime`. Non-live reloads carry it as `startTime`,
     * otherwise mpv would restart at the playback's original resume offset.
     */
    lastPositionSeconds: number | null;
    /**
     * Whether a positive position has been reported for this load. Engine
     * snapshots start at zero before the first `time-pos` update, so a zero
     * is trusted as a real seek-to-start only once that has happened.
     */
    positionReported: boolean;
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
        attemptInFlight: false,
        lastPositionSeconds: null,
        positionReported: false,
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
        state.attemptInFlight = false;
        state.lastPositionSeconds =
            typeof playback.startTime === 'number' &&
            Number.isFinite(playback.startTime) &&
            playback.startTime >= 0
                ? playback.startTime
                : null;
        state.positionReported = false;
        state.pending = null;
    }

    cancel(state: EmbeddedMpvReconnectState): void {
        this.clearTimer(state);
        state.attemptInFlight = false;
        state.pending = null;
    }

    /**
     * The user asked to pause. Observing `paused` cannot cover a pause sent
     * while the session already sits in a loss state (the engines keep
     * `error`/`ended` rather than flipping to `paused`), so the command
     * itself cancels and disarms: a reload would resume playback unasked.
     */
    onUserPause(state: EmbeddedMpvReconnectState): void {
        this.cancel(state);
        state.hadPlayed = false;
    }

    /**
     * Feed one observed status (and the position that came with it). Returns
     * what the renderer should be shown (`null` when nothing is pending).
     */
    observe(
        sessionId: string,
        state: EmbeddedMpvReconnectState,
        status: EmbeddedMpvSessionStatus,
        previousStatus: EmbeddedMpvSessionStatus | null,
        positionSeconds?: number,
        errorOrigin?: 'playback' | 'engine'
    ): EmbeddedMpvReconnectInfo | null {
        const now = this.now();

        if (status === 'error' && errorOrigin === 'engine') {
            this.cancel(state);
            return null;
        }

        if (
            (status === 'playing' || status === 'paused') &&
            typeof positionSeconds === 'number' &&
            Number.isFinite(positionSeconds)
        ) {
            if (positionSeconds > 0) {
                state.lastPositionSeconds = positionSeconds;
                state.positionReported = true;
            } else if (positionSeconds === 0 && state.positionReported) {
                // A real seek back to the start. Before any positive
                // position the zero is only the snapshot's placeholder and
                // the seeded `startTime` stays the better resume point.
                state.lastPositionSeconds = 0;
            }
        }

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
            if (status === 'paused') {
                // Disarmed until the stream plays again: reloading a stream
                // the user paused would resume it without them asking.
                state.hadPlayed = false;
            }
            this.cancel(state);
            return null;
        }

        const answersAttempt = state.attemptInFlight;
        if (
            (status === previousStatus && !answersAttempt) ||
            state.timer !== null
        ) {
            // Same loss observed again by the poll, or already scheduled.
            return state.pending;
        }

        state.attemptInFlight = false;
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
        const playback = this.playbackForReload(state.playback, state);
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
            state.attemptInFlight = true;
            try {
                this.hooks.reload(sessionId, playback);
            } catch (error) {
                state.attemptInFlight = false;
                if (isEmbeddedMpvSessionGoneError(error)) {
                    // Nothing behind the session can take a load any more;
                    // stop so the renderer shows the actionable error
                    // instead of a reconnect spinner that never resolves.
                    this.log.warn(
                        `[Embedded MPV][reconnect] session ${sessionId}: engine gone, giving up`,
                        error
                    );
                    state.pending = null;
                } else {
                    this.log.warn(
                        `[Embedded MPV][reconnect] session ${sessionId}: attempt ${attempt} could not start`,
                        error
                    );
                    // The addon refused the load outright, so no loading→loss
                    // transition will ever arrive: continue the backoff here.
                    this.schedule(sessionId, state, this.now());
                }
            }
            this.hooks.publish(sessionId);
        }, delay);
        return state.pending;
    }

    /**
     * Live streams reload at the live edge. Anything else resumes where the
     * connection dropped: the stored playback still carries the offset the
     * user originally resumed from, and reloading it would rewind the movie.
     */
    private playbackForReload(
        playback: ResolvedPortalPlayback,
        state: EmbeddedMpvReconnectState
    ): ResolvedPortalPlayback {
        if (
            isLiveEmbeddedMpvPlayback(playback) ||
            state.lastPositionSeconds === null
        ) {
            return playback;
        }
        return { ...playback, startTime: state.lastPositionSeconds };
    }

    private clearTimer(state: EmbeddedMpvReconnectState): void {
        if (state.timer !== null) {
            clearTimeout(state.timer);
            state.timer = null;
        }
    }
}
