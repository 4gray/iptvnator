import { resolveChannelEpgLookupKey } from '@iptvnator/m3u-state';
import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';

/**
 * Per-channel EPG metadata stored in a side-car map keyed by EPG lookup key.
 * Replaces the older EnrichedChannel pattern that spread-cloned every channel
 * on every progressTick (~30 s).
 */
export interface ChannelEpgMetadata {
    epgProgram: EpgProgram | null | undefined;
    progressPercentage: number;
}

/**
 * Current-programme progress as a clamped, rounded percentage in [0, 100].
 * Guards against missing/invalid timestamps and zero-length programmes so a bad
 * EPG row can never produce `NaN` or a runaway value.
 */
export function calculateEpgProgress(
    epgProgram: EpgProgram | null | undefined,
    now: number = Date.now()
): number {
    if (!epgProgram) {
        return 0;
    }

    const start = new Date(epgProgram.start).getTime();
    const stop = new Date(epgProgram.stop).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(stop)) {
        return 0;
    }

    const total = stop - start;
    if (total <= 0) {
        return 0;
    }

    const elapsed = Math.min(total, Math.max(0, now - start));
    return Math.round((elapsed / total) * 100);
}

/**
 * Resolves the current programme for a channel from the shared side-car EPG map
 * (keyed by the channel's EPG lookup key). Returns `null` when the channel has
 * no usable lookup key or no entry in the map.
 */
export function resolveChannelEpgProgram(
    channel: Channel,
    channelEpgMap: Map<string, EpgProgram | null>
): EpgProgram | null {
    const key = resolveChannelEpgLookupKey(channel);
    return key ? (channelEpgMap.get(key) ?? null) : null;
}

/**
 * Builds the side-car metadata map (lookup key → {programme, progress}) from the
 * shared `channelEpgMap`. Callers should read their `progressTick()` signal
 * first so the surrounding computed re-runs every tick.
 */
export function buildChannelEpgMetadataMap(
    channelEpgMap: Map<string, EpgProgram | null>,
    now: number = Date.now()
): Map<string, ChannelEpgMetadata> {
    const result = new Map<string, ChannelEpgMetadata>();
    channelEpgMap.forEach((program, channelId) => {
        result.set(channelId, {
            epgProgram: program,
            progressPercentage: calculateEpgProgress(program, now),
        });
    });
    return result;
}
