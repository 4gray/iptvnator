/**
 * Budget of the cross-source live channel failover.
 *
 * These live in the shared contract package, not beside the failover service,
 * because the external-player failover only needs the numbers and must stay
 * out of the initial bundle: importing `@iptvnator/playback/data-access` (or
 * `@iptvnator/playback/util`, whose diagnostics import hls.js) from a
 * bootstrap-path module pulls the whole player graph into the first download.
 */
export const LIVE_FAILOVER_MAX_RETRIES = 3;
/** Time one attempt (a reload or a hop) gets to reach `playing`. */
export const LIVE_FAILOVER_ATTEMPT_MS = 10_000;
/**
 * Time a hop gets to mount the candidate's player: navigation plus the
 * target source's catalog hydration. Once the player reports loading, the
 * player's own {@link LIVE_FAILOVER_ATTEMPT_MS} takes over.
 */
export const LIVE_FAILOVER_ARRIVAL_MS = 30_000;
/**
 * How long a channel that failed in a source is left out of later
 * searches, so two sources failing in turn cannot hop back and forth.
 */
export const LIVE_FAILOVER_FAILURE_MEMORY_MS = 10 * 60_000;
