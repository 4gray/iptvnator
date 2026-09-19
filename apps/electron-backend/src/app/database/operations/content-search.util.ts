/**
 * Pure text helpers for the content search pipeline (global search,
 * per-playlist search and M3U payload search). Everything here is
 * side-effect free and independent of drizzle so it can be unit tested
 * without database mocks; the SQL condition builders that consume these
 * helpers live in `content.operations.ts`.
 */

/** Minimum length the trigram FTS index can match (trigram = 3 chars). */
const MIN_COMPOUND_WORD_LENGTH = 3;

const WORD_EDGE_PUNCTUATION_REGEXP = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const INNER_PUNCTUATION_REGEXP = /[^\p{L}\p{N}]/u;

export function escapeLikePattern(term: string): string {
    return term.replace(/[%_\\]/g, '\\$&');
}

/**
 * Case spellings a stored title may use for `value`, for LIKE/GLOB patterns:
 * SQLite LIKE folds only ASCII and GLOB folds nothing, so every form has to
 * be spelled out. Besides lower/upper/title case, a value containing "i"
 * also gets the Turkish forms with the dotted capital İ (U+0130) — "inş"
 * becomes "İNŞ" / "İnş" — because the locale-invariant `toUpperCase()`
 * yields "INŞ", which never matches a title such as "İnşaat" (issue #609).
 * The explicit `'tr'` locale is the point: it is fixed, not the OS locale.
 */
function getCaseVariants(value: string): string[] {
    const lower = value.toLowerCase();
    const folded = lower.replace(/[\u0300-\u036f]/g, '');
    const variants = new Set<string>([
        value,
        lower,
        value.toUpperCase(),
        value.charAt(0).toUpperCase() + value.slice(1).toLowerCase(),
    ]);

    if (folded.includes('i')) {
        variants.add(folded.toLocaleUpperCase('tr'));
        variants.add(
            folded.charAt(0).toLocaleUpperCase('tr') + folded.slice(1)
        );
    }

    return [...variants];
}

// Search case folding is deliberately locale-invariant (toLowerCase, not
// toLocaleLowerCase). Under a Turkish or Azeri locale toLocaleLowerCase maps
// ASCII "I" to the dotless "ı" and folds the dotted "İ" its own way, so the
// same title would be found or missed depending on the user's OS locale, and
// the query would not line up with the SQLite FTS index, which folds
// locale-invariantly. Issue #609: "İnş" and "inş" returned different results.
export function normalizeSearchMatchText(value: unknown): string {
    return typeof value === 'string'
        ? value
              .normalize('NFKD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]+/gu, ' ')
              .trim()
              .replace(/\s+/g, ' ')
        : '';
}

function normalizeSqlSearchText(value: unknown): string {
    return typeof value === 'string'
        ? value
              .toLowerCase()
              // Drop the combining marks case folding leaves behind, before the
              // split below can read them as word separators: "İ" (U+0130)
              // lower-cases to "i" plus a combining dot above (U+0307), which
              // otherwise split "İnş" into "i" and "nş" while "inş" stayed one
              // token, routing the two differently (issue #609). Same
              // U+0300-U+036F range normalizeSearchMatchText strips; precomposed
              // letters (ç, ş, ü, é) are outside it and left untouched.
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^\p{L}\p{N}]+/gu, ' ')
              .trim()
              .replace(/\s+/g, ' ')
        : '';
}

function getSearchTokens(value: unknown): string[] {
    const normalized = normalizeSearchMatchText(value);
    return normalized ? normalized.split(' ') : [];
}

export function getSqlSearchTokenGroups(value: unknown): string[][] {
    const rawTokens = normalizeSqlSearchText(value).split(' ').filter(Boolean);
    const normalizedTokens = getSearchTokens(value);
    const tokenCount = Math.max(rawTokens.length, normalizedTokens.length);

    return Array.from({ length: tokenCount }, (_, index) =>
        [...new Set([rawTokens[index], normalizedTokens[index]])].filter(
            Boolean
        )
    ).filter((group) => group.length > 0);
}

export function isShortSearchTokenGroup(tokens: readonly string[]): boolean {
    return tokens.some((token) => token.length <= 2);
}

function getSqlSearchTokenVariants(value: unknown): string[] {
    return [...new Set(getSqlSearchTokenGroups(value).flat())];
}

export function buildLikePatterns(
    term: string,
    mode: 'contains' | 'prefix' = 'contains'
): string[] {
    const variants = new Set<string>();

    for (const value of [term, ...getSqlSearchTokenVariants(term)]) {
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            continue;
        }

        for (const variant of getCaseVariants(trimmedValue)) {
            variants.add(variant);
        }
    }

    return [...variants].map((value) => {
        const escapedValue = escapeLikePattern(value);
        return mode === 'prefix' ? `${escapedValue}%` : `%${escapedValue}%`;
    });
}

export function buildGlobPrefixPatterns(token: string): string[] {
    const variants = new Set<string>();

    for (const value of [token, ...getSqlSearchTokenVariants(token)]) {
        for (const variant of getCaseVariants(value)) {
            variants.add(variant);
        }
    }

    return [...variants].map((value) => `${value}*`);
}

export function shouldUseContentTitlePrefixIndex(searchTerm: string): boolean {
    const [firstTokenGroup] = getSqlSearchTokenGroups(searchTerm);

    return !!firstTokenGroup && isShortSearchTokenGroup(firstTokenGroup);
}

export function buildContentTitleFtsMatchQuery(searchTerm: string): string {
    return getSqlSearchTokenGroups(searchTerm)
        .map((tokens) => {
            const quotedTokens = tokens
                .filter((token) => token.length >= 3)
                .map((token) => `"${token.replace(/"/g, '""')}"`);

            if (quotedTokens.length <= 1) {
                return quotedTokens[0] ?? '';
            }

            return `(${quotedTokens.join(' OR ')})`;
        })
        .filter(Boolean)
        .join(' AND ');
}

export function shouldUseContentTitleFts(searchTerm: string): boolean {
    return (
        !shouldUseContentTitlePrefixIndex(searchTerm) &&
        buildContentTitleFtsMatchQuery(searchTerm).length > 0
    );
}

/**
 * Whitespace-delimited words from the raw search term that still contain
 * internal punctuation after trimming their edges — e.g. `a&e`, `x-men`,
 * `l'équipe`. Tokenization splits these into (often 1-letter) fragments
 * whose short-token handling anchors the search to the title start, so the
 * intact word is preserved as an additional exact-substring search unit
 * (issue #1161: "A&E" not finding "US: A&E").
 */
export function getCompoundSearchWords(value: unknown): string[] {
    if (typeof value !== 'string') {
        return [];
    }

    const words = new Set<string>();
    for (const rawWord of value.split(/\s+/)) {
        const word = rawWord.replace(WORD_EDGE_PUNCTUATION_REGEXP, '');
        if (
            word.length < MIN_COMPOUND_WORD_LENGTH ||
            !INNER_PUNCTUATION_REGEXP.test(word)
        ) {
            continue;
        }
        words.add(word);
    }

    return [...words];
}

/**
 * One whitespace-delimited search word with its token groups. `compound` is
 * the intact word when it contains internal punctuation (see
 * `getCompoundSearchWords`), else null. SQL condition builders compose
 * per-word conditions from this so a compound word's substring arm stays
 * AND-constrained by the other words of the query — `A&E HD` must not let
 * plain `A&E` titles flood the SQL candidate window before scoring runs.
 */
export interface SearchWordPlan {
    compound: string | null;
    tokenGroups: string[][];
}

export function getSearchWordPlans(value: unknown): SearchWordPlan[] {
    if (typeof value !== 'string') {
        return [];
    }

    const plans: SearchWordPlan[] = [];
    for (const rawWord of value.split(/\s+/)) {
        const word = rawWord.replace(WORD_EDGE_PUNCTUATION_REGEXP, '');
        if (!word) {
            continue;
        }

        const tokenGroups = getSqlSearchTokenGroups(word);
        if (tokenGroups.length === 0) {
            continue;
        }

        const isCompound =
            word.length >= MIN_COMPOUND_WORD_LENGTH &&
            INNER_PUNCTUATION_REGEXP.test(word);
        plans.push({ compound: isCompound ? word : null, tokenGroups });
    }

    return plans;
}

/**
 * Token groups of the non-compound words of the term. When the compound FTS
 * arm looks up `"a&e"` for `A&E HD`, these groups (`hd`) are re-applied as
 * LIKE conditions so the supplement cannot fill the candidate limit with
 * titles that match the compound word alone.
 */
export function getCompoundResidualTokenGroups(value: unknown): string[][] {
    return getSearchWordPlans(value)
        .filter((plan) => plan.compound === null)
        .flatMap((plan) => plan.tokenGroups);
}

/** As-typed plus diacritic-stripped forms, both long enough for trigram FTS. */
function getCompoundWordVariants(word: string): string[] {
    const stripped = word.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

    return [...new Set([word, stripped])].filter(
        (variant) => variant.length >= MIN_COMPOUND_WORD_LENGTH
    );
}

/**
 * Case/diacritic LIKE variants of a compound word as contains patterns
 * (`%a&e%`). SQLite LIKE is only case-insensitive for ASCII, so the same
 * lower/upper/title-case expansion as `buildLikePatterns` is applied.
 */
export function buildCompoundLikePatterns(word: string): string[] {
    const variants = new Set<string>();

    for (const value of getCompoundWordVariants(word)) {
        for (const variant of getCaseVariants(value)) {
            variants.add(variant);
        }
    }

    return [...variants].map((value) => `%${escapeLikePattern(value)}%`);
}

/**
 * Trigram FTS match query treating each compound word as a quoted substring
 * phrase: `"a&e"`, `("café" OR "cafe")`. The trigram tokenizer matches
 * case-insensitive substrings of >= 3 chars, so this finds the compound word
 * anywhere in the title without a table scan. Returns '' when the term has
 * no compound words.
 */
export function buildCompoundFtsMatchQuery(searchTerm: string): string {
    return getCompoundSearchWords(searchTerm)
        .map((word) => {
            const quotedVariants = [
                ...new Set(
                    getCompoundWordVariants(word).map((variant) =>
                        variant.toLowerCase()
                    )
                ),
            ].map((variant) => `"${variant.replace(/"/g, '""')}"`);

            if (quotedVariants.length <= 1) {
                return quotedVariants[0] ?? '';
            }

            return `(${quotedVariants.join(' OR ')})`;
        })
        .filter(Boolean)
        .join(' AND ');
}

export function buildM3uPayloadTextFieldPatterns(
    token: string,
    mode: 'contains' | 'prefix'
): string[] {
    return buildLikePatterns(token, mode).flatMap((pattern) =>
        wrapM3uPayloadTextFieldPattern(pattern)
    );
}

/** Compound-word contains patterns scoped to M3U payload name/title fields. */
export function buildM3uPayloadCompoundPatterns(word: string): string[] {
    return buildCompoundLikePatterns(word).flatMap((pattern) =>
        wrapM3uPayloadTextFieldPattern(pattern)
    );
}

function wrapM3uPayloadTextFieldPattern(pattern: string): string[] {
    return [
        `%"name":"${pattern}"%`,
        `%"name": "${pattern}"%`,
        `%"title":"${pattern}"%`,
        `%"title": "${pattern}"%`,
    ];
}

export function scoreSearchTextMatch(
    value: string,
    searchTerm: string
): number | null {
    const candidateText = normalizeSearchMatchText(value);
    const searchText = normalizeSearchMatchText(searchTerm);
    if (!candidateText || !searchText) {
        return null;
    }

    const searchTokens = searchText.split(' ');
    const candidateTokens = candidateText.split(' ');
    const firstSearchToken = searchTokens[0];

    if (
        firstSearchToken.length <= 2 &&
        !candidateText.startsWith(firstSearchToken)
    ) {
        // Short first tokens stay prefix-anchored to keep one-letter noise
        // out, but a multi-token phrase ("a e" from "A&E") may still match as
        // a whole word sequence anywhere in the title ("US: A&E").
        if (
            searchTokens.length > 1 &&
            ` ${candidateText} `.includes(` ${searchText} `)
        ) {
            return 40;
        }
        return null;
    }

    if (candidateText === searchText) {
        return 0;
    }

    if (
        candidateText.startsWith(searchText) &&
        (searchTokens.length > 1 || firstSearchToken.length <= 2)
    ) {
        return 10;
    }

    if (candidateTokens.some((token) => token.startsWith(searchText))) {
        return 20;
    }

    if (
        searchTokens.every((searchToken) =>
            candidateTokens.some((candidateToken) =>
                candidateToken.startsWith(searchToken)
            )
        )
    ) {
        return 30;
    }

    if (candidateText.includes(searchText)) {
        return 40;
    }

    if (
        searchTokens.every((searchToken) => candidateText.includes(searchToken))
    ) {
        return 50;
    }

    return null;
}
