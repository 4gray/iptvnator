import { computed } from '@angular/core';
import type { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';

/**
 * "Jump to live" for Embedded MPV: skip the backlog mpv has buffered for a
 * live MPEG-TS stream so playback runs a few seconds behind the broadcast.
 *
 * Why TS only: an Xtream-style `.ts` live stream is one endless HTTP response.
 * On connect the server bursts its own backlog (often 20–30 s) and then sends
 * at real-time rate, so the viewer starts that far behind live. mpv can seek
 * inside its demuxer cache even though it reports the stream as not seekable,
 * and because data keeps arriving continuously, the buffer refills after at
 * most one short stall.
 *
 * HLS (`file-format` `hls`) is deliberately excluded: its cache ends at the
 * newest *complete* segment, so leaving a few seconds there drains the buffer
 * before the next segment (often ~10 s) arrives — a stall plus A/V resync on
 * every segment. Making that safe needs the provider's segment length.
 */

/** Buffer the jump leaves ahead of playback, in seconds. Covers delivery jitter. */
export const LIVE_EDGE_TARGET_SECONDS = 3;

/**
 * After a jump, ignore further jumps this long. The snapshot that answers the
 * seek may still carry the pre-seek buffer value; a second click on it would
 * seek past the end of the cache.
 */
export const LIVE_EDGE_SETTLE_MS = 2000;

/** mpv `file-format` of a raw MPEG transport stream. */
const MPEG_TS_CONTAINER = 'mpegts';

/** True when the session plays a container the jump is safe for. */
export function isLiveEdgeContainer(
    session: EmbeddedMpvSession | null | undefined
): boolean {
    return session?.stats?.container === MPEG_TS_CONTAINER;
}

/**
 * Seconds to seek forward so `LIVE_EDGE_TARGET_SECONDS` stay buffered, or
 * null when the session cannot jump (not playing, reconnecting, not TS, or
 * the buffer is already at or below that target).
 *
 * `bufferedAheadSeconds` comes from the polled session snapshot and can be a
 * few hundred milliseconds old; the buffer only grows in that time, so the
 * result errs towards keeping slightly more than the target.
 */
export function liveEdgeJumpSeconds(
    session: EmbeddedMpvSession | null | undefined
): number | null {
    if (
        !session ||
        session.reconnect ||
        (session.status !== 'playing' && session.status !== 'paused') ||
        !isLiveEdgeContainer(session)
    ) {
        return null;
    }

    const bufferedAhead = session.stats?.bufferedAheadSeconds;
    if (typeof bufferedAhead !== 'number' || !Number.isFinite(bufferedAhead)) {
        return null;
    }

    const jumpSeconds = bufferedAhead - LIVE_EDGE_TARGET_SECONDS;
    return jumpSeconds > 0 ? jumpSeconds : null;
}

/**
 * The live-edge state of one Embedded MPV controls adapter: whether the
 * session plays a container the jump is offered for, and the debounced jump.
 * The button stays enabled; a click with ≤ 3 s buffered simply does nothing.
 */
export class EmbeddedMpvLiveEdge {
    /**
     * A boolean (not the session) so a snapshot that only moves the numbers
     * never invalidates the capability set downstream.
     */
    readonly supported = computed(() => isLiveEdgeContainer(this.session()));
    private settledAt = 0;

    constructor(
        private readonly session: () => EmbeddedMpvSession | null,
        private readonly seekBy: (deltaSeconds: number) => Promise<unknown>,
        private readonly now: () => number = Date.now
    ) {}

    /**
     * Seeks towards the live edge; returns false when nothing was sent.
     * Repeats are ignored for `LIVE_EDGE_SETTLE_MS`.
     */
    jump(): boolean {
        const jumpSeconds = liveEdgeJumpSeconds(this.session());
        if (jumpSeconds === null || this.now() < this.settledAt) {
            return false;
        }

        this.settledAt = this.now() + LIVE_EDGE_SETTLE_MS;
        void this.seekBy(jumpSeconds);
        return true;
    }
}
