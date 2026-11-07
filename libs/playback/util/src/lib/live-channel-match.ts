/**
 * Fuzzy "same channel" matching for live channel failover across sources.
 *
 * Provider ids are not comparable between playlists, so matching is purely
 * name based. The asymmetry that matters: a provider may shorten or
 * decorate a name (`"ERT 1 HD"` for `"ERT1"`, `"GR: Nova Sport Prime"` for
 * `"Nova Sports Prime"`) but may not invent a word the target never had —
 * `"ERT 1"` is never `"ERT Sports 1"`. Ported from OwnTV's
 * `ChannelFailover.kt`.
 */

/** Minimum {@link liveChannelMatchScore} for the same channel. */
export const LIVE_CHANNEL_MATCH_MIN_SCORE = 0.45;

/** Words that mark picture quality or region, not which channel it is. */
const NAME_DECORATIONS = new Set([
    'hd',
    'fhd',
    'uhd',
    'qhd',
    'sd',
    'hdr',
    '4k',
    '8k',
    'hevc',
    'h264',
    'h265',
    'gr',
    'uk',
    'us',
    'de',
    'fr',
    'it',
    'es',
    'pt',
    'nl',
    'tr',
]);

const RESOLUTION_TOKEN = /^\d{3,4}[pi]$/;

function channelTokens(name: string): string[] {
    const words = name
        .normalize('NFD')
        .replace(/\p{Mn}+/gu, '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
    return [...new Set(words)];
}

/** {@link channelTokens} without quality/region decorations. */
function significantTokens(name: string): string[] {
    return channelTokens(name).filter(
        (token) => !NAME_DECORATIONS.has(token) && !RESOLUTION_TOKEN.test(token)
    );
}

/** Compact identity key: letters and digits only (`"ERT-1"` → `"ert1"`). */
export function liveChannelKey(name: string): string {
    return channelTokens(name).join('');
}

/** The same word: equal, or a plural/abbreviation (`sport` ≈ `sports`). */
function tokensMatch(a: string, b: string): boolean {
    if (a === b) {
        return true;
    }
    const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
    return (
        shorter.length >= 4 &&
        longer.length - shorter.length <= 3 &&
        longer.startsWith(shorter)
    );
}

/**
 * How likely `candidateName` is the same channel as `targetName`, from 0 to
 * 1. The candidate is scored on how much of the target it covers, and any
 * word it adds disqualifies it.
 */
export function liveChannelMatchScore(
    targetName: string,
    candidateName: string
): number {
    const target = liveChannelKey(targetName);
    const candidate = liveChannelKey(candidateName);
    if (!target || !candidate) {
        return 0;
    }
    if (target === candidate) {
        return 1;
    }
    const targetTokens = significantTokens(targetName);
    const candidateTokens = significantTokens(candidateName);
    const targetBare = targetTokens.join('');
    if (targetBare && targetBare === candidateTokens.join('')) {
        return 0.9;
    }
    if (targetTokens.length === 0 || candidateTokens.length === 0) {
        return 0;
    }
    // A number is part of which channel this is: "ESPN" is not "ESPN 2".
    // The fused spelling ("ERT1" for "ERT 1") was already accepted above.
    const missingNumber = targetTokens
        .filter((token) => /^\d+$/.test(token))
        .some((number) => !candidateTokens.includes(number));
    if (missingNumber) {
        return 0;
    }
    const addsWords = candidateTokens.some(
        (word) => !targetTokens.some((own) => tokensMatch(own, word))
    );
    if (addsWords) {
        return 0;
    }
    const covered = targetTokens.filter((own) =>
        candidateTokens.some((word) => tokensMatch(own, word))
    ).length;
    return (covered / targetTokens.length) * 0.9;
}

/**
 * Search terms for finding `name` in other sources, most specific first:
 * the name without decorations, then its longest word for providers that
 * spell the name differently (`"Sport"` for `"Sports"`).
 */
export function liveChannelSearchProbes(name: string): string[] {
    const tokens = significantTokens(name);
    const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
    const probes = [tokens.join(' ')];
    if (longest && longest.length >= 3) {
        probes.push(longest);
    }
    return [...new Set(probes.filter(Boolean))];
}

export interface LiveChannelCandidate {
    playlistId: string;
    title: string;
}

/**
 * The failover hop order for `targetName`: each source's best match, one
 * per source, in `playlistOrder` (sources not listed are dropped), skipping
 * `excludePlaylistId` — the source that just failed.
 */
export function rankLiveChannelCandidates<T extends LiveChannelCandidate>(
    targetName: string,
    candidates: readonly T[],
    playlistOrder: readonly string[],
    excludePlaylistId: string | null,
    minScore = LIVE_CHANNEL_MATCH_MIN_SCORE
): T[] {
    const best = new Map<string, { candidate: T; score: number }>();
    for (const candidate of candidates) {
        if (candidate.playlistId === excludePlaylistId) {
            continue;
        }
        const score = liveChannelMatchScore(targetName, candidate.title);
        const current = best.get(candidate.playlistId);
        if (score >= minScore && (!current || score > current.score)) {
            best.set(candidate.playlistId, { candidate, score });
        }
    }
    const ranked: T[] = [];
    for (const playlistId of playlistOrder) {
        const match = best.get(playlistId);
        if (match) {
            ranked.push(match.candidate);
        }
    }
    return ranked;
}
