import type { HlsConfig } from 'hls.js';

/**
 * HLS buffer/latency profiles applied over {@link hlsWorkerConfig}'s worker
 * setup. A single profile is chosen in Settings and merged into every
 * `new Hls(...)` call, so the web players and ArtPlayer behave alike.
 *
 * The values are a starting profile, not a universal setting: live sync
 * targets are expressed in segments, so they land differently on a 2 s and a
 * 10 s segment duration. Tune against real streams before changing them.
 *
 * If `adjustLiveSyncForSegmentDuration` is called after `MANIFEST_PARSED`,
 * `liveSyncDurationCount` is rescaled to hit ~6s (lowLatency), ~10s (balanced),
 * ~16s (stable) regardless of segment duration.
 */
const IPTV_HLS_CONFIG = {
    /** Low delay for stable links (sport); a short buffer risks more stalls. */
    lowLatency: {
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        backBufferLength: 20,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        maxLiveSyncPlaybackRate: 1.05,
        nudgeMaxRetry: 3,
        fragLoadingTimeOut: 15_000,
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 500,
        startLevel: -1,
    },
    /** Default: reasonable delay with room for CDN jitter and provider stalls. */
    balanced: {
        maxBufferLength: 25,
        maxMaxBufferLength: 45,
        backBufferLength: 30,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        maxLiveSyncPlaybackRate: 1.1,
        nudgeMaxRetry: 5,
        fragLoadingTimeOut: 20_000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1_000,
        startLevel: -1,
    },
    /** Deep buffer for unstable links; absorbs jitter at the cost of delay. */
    stable: {
        maxBufferLength: 40,
        maxMaxBufferLength: 80,
        backBufferLength: 50,
        liveSyncDurationCount: 4,
        liveMaxLatencyDurationCount: 8,
        maxLiveSyncPlaybackRate: 1.15,
        nudgeMaxRetry: 7,
        fragLoadingTimeOut: 30_000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1_500,
        startLevel: -1,
    },
} as const satisfies Record<string, Partial<HlsConfig>>;

export type HlsBufferProfile = keyof typeof IPTV_HLS_CONFIG;

/**
 * The mpegts.js counterpart, keyed by profile. mpegts.js has no live-sync
 * notion of its own, so only the buffer sizes move with the profile; the
 * live stall on a `.ts` stream is covered by the existing reconnect logic.
 */
const MPEGTS_BUFFER_CONFIG = {
    lowLatency: {
        liveBufferLatencyChasing: true,
        lazyLoadMaxDuration: 3,
        lazyLoadRecoverDuration: 3,
        fixAudioTimestampGap: false,
    },
    balanced: {
        liveBufferLatencyChasing: true,
        lazyLoadMaxDuration: 5,
        lazyLoadRecoverDuration: 5,
        fixAudioTimestampGap: false,
    },
    stable: {
        liveBufferLatencyChasing: false,
        lazyLoadMaxDuration: 8,
        lazyLoadRecoverDuration: 8,
        fixAudioTimestampGap: true,
    },
} as const;

/**
 * The `hls.js` subset of a profile, as `Hls.Config`. Every profile key is
 * already an `Hls.Config` key, so this is the shape the players pass to
 * `new Hls(...)`.
 */
export type HlsBufferProfileConfig = Partial<HlsConfig>;

export type MpegTsBufferProfileConfig = Partial<
    (typeof MPEGTS_BUFFER_CONFIG)['balanced']
>;

/**
 * The profile a setting stores, defaulted. A stored value from an older
 * release (or a corrupted one) falls back to `balanced`.
 */
export function resolveHlsBufferProfile(
    value: string | null | undefined
): HlsBufferProfile {
    return value === 'lowLatency' || value === 'stable' ? value : 'balanced';
}

/** The mpegts.js buffer options for one profile, for the `.ts` engines. */
export function mpegTsBufferConfig(
    profile: HlsBufferProfile
): Record<string, unknown> {
    return MPEGTS_BUFFER_CONFIG[profile] as Record<string, unknown>;
}

/**
 * Adjust `liveSyncDurationCount` so the live edge target is ~seconds,
 * regardless of segment duration. Call once after `MANIFEST_PARSED`:
 * ```ts
 * hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
 *   adjustLiveSyncForSegmentDuration(hls, 'balanced', data.details.avgDuration);
 * });
 * ```
 * Targets: lowLatency ~6s, balanced ~10s, stable ~16s.
 */
export function adjustLiveSyncForSegmentDuration(
    hls: { config: { liveSyncDurationCount: number; liveMaxLatencyDurationCount: number } },
    profile: HlsBufferProfile,
    targetDuration: number
): void {
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) return;
    const targetSeconds: Record<HlsBufferProfile, number> = {
        lowLatency: 6,
        balanced: 10,
        stable: 16,
    };
    const count = Math.max(1, Math.round(targetSeconds[profile] / targetDuration));
    hls.config.liveSyncDurationCount = count;
    hls.config.liveMaxLatencyDurationCount = count * 2;
}

export { IPTV_HLS_CONFIG };