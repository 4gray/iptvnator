import type { EpgChannelMetadata } from '@iptvnator/shared/interfaces';

/**
 * Lookup tables over the EPG channel candidates of one batch. Built once per
 * candidate list, so resolving N requested channel keys costs
 * O(N + candidates) instead of scanning every candidate for every key — the
 * scan made a 90k-channel playlist block the main process for minutes.
 *
 * Each table keeps the first candidate seen for a key, which is the candidate
 * a linear `Array.prototype.find` over the same list would return.
 */
export interface EpgChannelCandidateIndex {
    readonly byId: ReadonlyMap<string, EpgChannelMetadata>;
    readonly byLowerId: ReadonlyMap<string, EpgChannelMetadata>;
    readonly byDisplayName: ReadonlyMap<string, EpgChannelMetadata>;
    readonly byLowerDisplayName: ReadonlyMap<string, EpgChannelMetadata>;
}

export function indexEpgChannelCandidates(
    candidates: readonly EpgChannelMetadata[]
): EpgChannelCandidateIndex {
    const byId = new Map<string, EpgChannelMetadata>();
    const byLowerId = new Map<string, EpgChannelMetadata>();
    const byDisplayName = new Map<string, EpgChannelMetadata>();
    const byLowerDisplayName = new Map<string, EpgChannelMetadata>();

    for (const candidate of candidates) {
        const { id, displayName } = candidate;
        keepFirst(byId, id, candidate);
        keepFirst(byLowerId, id.toLowerCase(), candidate);
        keepFirst(byDisplayName, displayName, candidate);
        keepFirst(byLowerDisplayName, displayName.toLowerCase(), candidate);
    }

    return { byId, byLowerId, byDisplayName, byLowerDisplayName };
}

/**
 * Match precedence: exact id, case-insensitive id, exact display name, then
 * case-insensitive display name. Folding uses full-Unicode `toLowerCase()`,
 * which SQLite's ASCII-only `LOWER()` cannot do for names such as Cyrillic.
 */
export function resolveEpgChannelCandidate(
    index: EpgChannelCandidateIndex,
    channelId: string
): EpgChannelMetadata | null {
    const lowerChannelId = channelId.toLowerCase();
    return (
        index.byId.get(channelId) ??
        index.byLowerId.get(lowerChannelId) ??
        index.byDisplayName.get(channelId) ??
        index.byLowerDisplayName.get(lowerChannelId) ??
        null
    );
}

function keepFirst(
    map: Map<string, EpgChannelMetadata>,
    key: string,
    candidate: EpgChannelMetadata
): void {
    if (!map.has(key)) {
        map.set(key, candidate);
    }
}
