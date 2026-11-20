/** Existing conservative key used by name recovery. */
export function normalizeEpgName(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/\b(?:hd|fhd|uhd|4k)\b/gi, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * More permissive fallback key. Strip only a recognized terminal quality
 * marker, then remove separators while retaining letters and channel numbers.
 */
export function normalizeEpgNameFlexibly(value: string): string {
    const withoutQualitySuffix = value.replace(
        /(?:[\s._:/-]*)(?:full[\s._-]*hd|fhd|uhd|4k|hd\+?|sd)$/i,
        ''
    );
    return withoutQualitySuffix
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Similarity key that removes separators but keeps quality suffixes. */
export function normalizeEpgNameForSimilarity(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}+]/gu, '');
}

/** Levenshtein similarity in the inclusive range [0, 1]. */
export function scoreEpgNameSimilarity(left: string, right: string): number {
    const a = normalizeEpgNameForSimilarity(left);
    const b = normalizeEpgNameForSimilarity(right);
    if (a === b) return 1;
    if (!a || !b) return 0;

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let row = 1; row <= a.length; row++) {
        const current = [row];
        for (let column = 1; column <= b.length; column++) {
            current[column] = Math.min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
            );
        }
        previous = current;
    }

    return 1 - previous[b.length] / Math.max(a.length, b.length);
}

/** Numeric channel labels are identity, not noise: keep their full sequence. */
export function getEpgNameNumberSignature(value: string): string {
    const withoutQuality = value.replace(
        /[\s._:/-]*(?:full[\s._-]*hd|fhd|uhd|4k|hd\+?|sd)$/i,
        ''
    );
    return (withoutQuality.match(/\p{N}+/gu) ?? []).join('-');
}

/**
 * Candidate gate for the last-resort fuzzy lookup. It keeps comparisons
 * bounded to names sharing a meaningful token or compact prefix, and never
 * compares channels with different numeric labels.
 */
export function isPlausibleEpgNameCandidate(
    requested: string,
    candidate: string
): boolean {
    if (
        getEpgNameNumberSignature(requested) !==
        getEpgNameNumberSignature(candidate)
    ) {
        return false;
    }

    const left = normalizeEpgNameForSimilarity(requested).replace(/\+/g, '');
    const right = normalizeEpgNameForSimilarity(candidate).replace(/\+/g, '');
    const leftWords = requested
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/([\p{L}])([\p{N}])/gu, '$1 $2')
        .replace(/([\p{N}])([\p{L}])/gu, '$1 $2')
        .match(/[\p{L}\p{N}]+/gu) ?? [];
    const rightWords = candidate
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/([\p{L}])([\p{N}])/gu, '$1 $2')
        .replace(/([\p{N}])([\p{L}])/gu, '$1 $2')
        .match(/[\p{L}\p{N}]+/gu) ?? [];
    const meaningfulLeft = leftWords.filter((word) => !isQualityWord(word));
    const meaningfulRight = rightWords.filter((word) => !isQualityWord(word));
    const sharedToken = meaningfulLeft.some((leftWord) =>
        meaningfulRight.some(
            (rightWord) =>
                leftWord === rightWord ||
                (leftWord.length >= 4 && rightWord.startsWith(leftWord)) ||
                (rightWord.length >= 4 && leftWord.startsWith(rightWord)) ||
                (leftWord.length >= 7 && rightWord.includes(leftWord)) ||
                (rightWord.length >= 7 && leftWord.includes(rightWord)) ||
                (leftWord.length >= 7 && rightWord.length >= 7 && scoreEpgNameSimilarity(leftWord, rightWord) >= 0.7)
        )
    );
    const compactPrefix =
        left.length >= 4 &&
        right.length >= 4 &&
        (left.startsWith(right.slice(0, Math.min(6, right.length))) ||
            right.startsWith(left.slice(0, Math.min(6, left.length))));
    return sharedToken || compactPrefix;
}

/** Token-aware score used only by the last-resort fuzzy stage. */
export function scoreEpgNameTokenSimilarity(
    left: string,
    right: string
): number {
    const tokens = (value: string) =>
        value
            .replace(/[\s._:/-]*(?:full[\s._-]*hd|fhd|uhd|4k|hd\+?|sd)$/i, '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase()
            .replace(/([\p{L}])([\p{N}])/gu, '$1 $2')
            .replace(/([\p{N}])([\p{L}])/gu, '$1 $2')
            .match(/[\p{L}\p{N}]+/gu)
            ?.filter((token) => !/^(?:de|del|la|el|the|of)$/.test(token)) ?? [];
    const leftTokens = tokens(left);
    const rightTokens = tokens(right);
    if (!leftTokens.length || !rightTokens.length) return 0;

    const pairs: Array<{ left: number; right: number; score: number }> = [];
    for (let i = 0; i < leftTokens.length; i++) {
        for (let j = 0; j < rightTokens.length; j++) {
            pairs.push({
                left: i,
                right: j,
                score: scoreEpgNameSimilarity(leftTokens[i], rightTokens[j]),
            });
        }
    }
    pairs.sort((a, b) => b.score - a.score || a.left - b.left || a.right - b.right);
    const usedLeft = new Set<number>();
    const usedRight = new Set<number>();
    let total = 0;
    for (const pair of pairs) {
        if (pair.score < 0.45 || usedLeft.has(pair.left) || usedRight.has(pair.right)) continue;
        usedLeft.add(pair.left);
        usedRight.add(pair.right);
        total += pair.score;
    }
    return (2 * total) / (leftTokens.length + rightTokens.length);
}

function isQualityWord(word: string): boolean {
    return /^(?:hd|fhd|uhd|4k|sd|full)$/.test(word);
}

/** Accept a fuzzy result only above threshold and clearly ahead of runner-up. */
export function selectConfidentEpgNameCandidate(
    candidates: ReadonlyMap<string, { score: number }>,
    minimumScore = 0.72,
    minimumMargin = 0.08
): string | null {
    const ranked = [...candidates].sort(
        ([leftId, left], [rightId, right]) =>
            right.score - left.score || leftId.localeCompare(rightId)
    );
    const best = ranked[0];
    if (!best || best[1].score < minimumScore) return null;
    if (
        ranked.length > 1 &&
        best[1].score - ranked[1][1].score < minimumMargin
    ) {
        return null;
    }
    return best[0];
}

export function selectBestEpgNameCandidate(
    candidates: ReadonlyMap<string, { score: number }>,
    eligibleIds?: ReadonlySet<string>
): string | null {
    let best: [string, { score: number }] | null = null;
    for (const candidate of candidates) {
        if (eligibleIds && !eligibleIds.has(candidate[0])) continue;
        if (
            !best ||
            candidate[1].score > best[1].score ||
            (candidate[1].score === best[1].score && candidate[0] < best[0])
        ) {
            best = candidate;
        }
    }
    return best?.[0] ?? null;
}
