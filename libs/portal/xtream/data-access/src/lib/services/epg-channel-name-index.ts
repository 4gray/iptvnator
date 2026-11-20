import {
    getEpgNameNumberSignature,
    isPlausibleEpgNameCandidate,
    normalizeEpgName,
    normalizeEpgNameFlexibly,
    scoreEpgNameSimilarity,
    scoreEpgNameTokenSimilarity,
    selectBestEpgNameCandidate,
    selectConfidentEpgNameCandidate,
} from './epg-name-normalization';

export interface ChannelNameIndex {
    normalized: Map<string, Map<string, Set<string>>>;
    flexible: Map<string, Map<string, Set<string>>>;
    names: Map<string, Set<string>>;
    fuzzy: Map<string, Map<string, Set<string>>>;
}

export interface ChannelNameCandidateGroups {
    byKey: Map<string, Map<string, { score: number }>>;
    fuzzyKeys: Set<string>;
}

/** Cached 3-gram buckets narrow the fuzzy scan before edit-distance scoring. */
function getNameGrams(value: string): Set<string> {
    const withoutQuality = value.replace(
        /(?:full[\s._-]*hd|fhd|uhd|4k|hd\+?|sd)$/i,
        ''
    );
    const words = withoutQuality
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/([\p{L}])([\p{N}])/gu, '$1 $2')
        .replace(/([\p{N}])([\p{L}])/gu, '$1 $2')
        .match(/[\p{L}]+/gu) ?? [];
    const grams = new Set<string>();
    for (const word of words) {
        if (/^(?:de|del|la|el|the|of)$/.test(word)) continue;
        for (let index = 0; index <= word.length - 3; index++) {
            grams.add(word.slice(index, index + 3));
        }
    }
    return grams;
}

export function createChannelNameIndex(
    channels: ReadonlyArray<{ id: string; displayName: string }>
): ChannelNameIndex {
    const index: ChannelNameIndex = {
        normalized: new Map(),
        flexible: new Map(),
        names: new Map(),
        fuzzy: new Map(),
    };
    for (const row of channels) {
        const names = index.names.get(row.id) ?? new Set<string>();
        names.add(row.displayName);
        index.names.set(row.id, names);
        const signature = getEpgNameNumberSignature(row.displayName);
        const gramsBySignature = index.fuzzy.get(signature) ?? new Map();
        for (const gram of getNameGrams(row.displayName)) {
            const ids = gramsBySignature.get(gram) ?? new Set<string>();
            ids.add(row.id);
            gramsBySignature.set(gram, ids);
        }
        index.fuzzy.set(signature, gramsBySignature);
        addToNameIndex(index.normalized, normalizeEpgName(row.displayName), row);
        addToNameIndex(
            index.flexible,
            normalizeEpgNameFlexibly(row.displayName),
            row
        );
    }
    return index;
}

function addToNameIndex(
    index: Map<string, Map<string, Set<string>>>,
    key: string,
    row: { id: string; displayName: string }
): void {
    if (!key) return;
    const candidates = index.get(key) ?? new Map();
    const names = candidates.get(row.id) ?? new Set<string>();
    names.add(row.displayName);
    candidates.set(row.id, names);
    index.set(key, candidates);
}

export function findChannelNameCandidates(
    namesByKey: ReadonlyMap<string, string[]>,
    index: ChannelNameIndex
): ChannelNameCandidateGroups {
    const groups: ChannelNameCandidateGroups = {
        byKey: new Map(),
        fuzzyKeys: new Set(),
    };
    const addCandidates = (
        key: string,
        candidates: Map<string, Set<string>> | undefined,
        originals: string[]
    ) => {
        if (!candidates) return;
        const group = groups.byKey.get(key) ?? new Map();
        for (const [id, candidateNames] of candidates) {
            let score = 0;
            for (const candidateName of candidateNames) {
                for (const name of originals) {
                    score = Math.max(
                        score,
                        scoreEpgNameSimilarity(name, candidateName)
                    );
                }
            }
            const current = group.get(id);
            if (current) current.score = Math.max(current.score, score);
            else group.set(id, { score });
        }
        groups.byKey.set(key, group);
    };

    for (const [key, originals] of namesByKey) {
        const exact = index.normalized.get(key);
        if (exact?.size) {
            addCandidates(key, exact, originals);
            continue;
        }
        for (const name of originals) {
            const flexibleKey = normalizeEpgNameFlexibly(name);
            if (flexibleKey) {
                addCandidates(key, index.flexible.get(flexibleKey), [name]);
            }
        }
        if (groups.byKey.get(key)?.size) continue;

        const fuzzy = new Map<string, { score: number }>();
        const candidateIds = new Set<string>();
        for (const name of originals) {
            const grams = index.fuzzy.get(getEpgNameNumberSignature(name));
            for (const gram of getNameGrams(name)) {
                for (const id of grams?.get(gram) ?? []) candidateIds.add(id);
            }
        }
        for (const id of candidateIds) {
            const candidateNames = index.names.get(id);
            if (!candidateNames) continue;
            let score = 0;
            for (const candidateName of candidateNames) {
                for (const name of originals) {
                    if (!isPlausibleEpgNameCandidate(name, candidateName)) continue;
                    score = Math.max(
                        score,
                        scoreEpgNameTokenSimilarity(name, candidateName)
                    );
                }
            }
            if (score > 0) fuzzy.set(id, { score });
        }
        if (fuzzy.size) {
            groups.byKey.set(key, fuzzy);
            groups.fuzzyKeys.add(key);
        }
    }
    return groups;
}

export function getChannelNameCandidateIdsForProgramCheck(
    groups: ChannelNameCandidateGroups
): string[] {
    const ids = new Set<string>();
    for (const [key, candidates] of groups.byKey) {
        if (candidates.size <= 1 && !groups.fuzzyKeys.has(key)) continue;
        for (const id of candidates.keys()) ids.add(id);
    }
    return [...ids];
}

export function selectChannelNameCandidates(
    keys: Iterable<string>,
    groups: ChannelNameCandidateGroups,
    idsWithPrograms: ReadonlySet<string> | null
): Record<string, string | null> {
    const result: Record<string, string | null> = {};
    for (const key of keys) {
        const candidates = groups.byKey.get(key);
        if (!candidates?.size) {
            result[key] = null;
            continue;
        }
        const requireCurrentProgram =
            candidates.size > 1 || groups.fuzzyKeys.has(key);
        const eligible = requireCurrentProgram
            ? idsWithPrograms ?? new Set<string>()
            : undefined;
        if (groups.fuzzyKeys.has(key)) {
            const eligibleCandidates = new Map(
                [...candidates].filter(
                    ([id]) => !eligible || eligible.has(id)
                )
            );
            result[key] = selectConfidentEpgNameCandidate(eligibleCandidates);
        } else {
            result[key] = selectBestEpgNameCandidate(candidates, eligible);
        }
    }
    return result;
}
