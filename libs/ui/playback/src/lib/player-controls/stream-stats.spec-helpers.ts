import type { PlayerStreamStats } from './player-stream-stats.model';

/**
 * A snapshot with nothing reported yet, for specs that care about one or two
 * fields and want the rest absent.
 *
 * Deliberately a test helper rather than a published constant: production
 * mappers list every field explicitly, so that a newly added stat fails to
 * compile until its source is decided instead of defaulting to null.
 */
export function emptyStreamStats(
    overrides: Partial<PlayerStreamStats> = {}
): PlayerStreamStats {
    return {
        width: null,
        height: null,
        fps: null,
        videoBitrateBps: null,
        audioBitrateBps: null,
        videoCodec: null,
        audioCodec: null,
        audioChannels: null,
        audioSampleRateHz: null,
        container: null,
        bufferedAheadSeconds: null,
        droppedFrames: null,
        totalFrames: null,
        ...overrides,
    };
}
