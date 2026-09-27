import { foldSearchText } from '@iptvnator/shared/interfaces';

/**
 * Texts of one searchable item, by how strongly a hit counts: the visible
 * label first, then curated keywords, then supporting context (description,
 * section name).
 */
export interface SearchRankFields {
    readonly label: string;
    readonly keywords?: readonly string[];
    readonly context?: readonly string[];
}

const LABEL_WEIGHT = 12;
const KEYWORD_WEIGHT = 6;
const CONTEXT_WEIGHT = 2;
const LABEL_PHRASE_PREFIX_BONUS = 20;
const LABEL_PHRASE_BONUS = 8;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Folded, whitespace-separated query tokens; empty for a blank query. */
export function tokenizeSearchQuery(query: string): string[] {
    return foldSearchText(query).split(/\s+/).filter(Boolean);
}

/**
 * Relevance of `fields` for the query tokens; `0` means no match. Every
 * token must match somewhere (AND semantics), so adding a word narrows the
 * results. A hit at the start of a text beats a hit at a word start, which
 * beats a hit inside a word; the whole query as a label prefix wins
 * outright. Pure and locale-invariant (see `foldSearchText`).
 */
export function rankSearchMatch(
    tokens: readonly string[],
    fields: SearchRankFields
): number {
    if (tokens.length === 0) {
        return 0;
    }

    const label = foldSearchText(fields.label);
    const keywords = (fields.keywords ?? []).map(foldSearchText);
    const context = (fields.context ?? []).map(foldSearchText);

    let score = 0;
    for (const token of tokens) {
        const tokenScore = Math.max(
            scoreText(label, token, LABEL_WEIGHT),
            ...keywords.map((text) => scoreText(text, token, KEYWORD_WEIGHT)),
            ...context.map((text) => scoreText(text, token, CONTEXT_WEIGHT))
        );
        if (tokenScore === 0) {
            return 0;
        }
        score += tokenScore;
    }

    const phrase = tokens.join(' ');
    if (label.startsWith(phrase)) {
        score += LABEL_PHRASE_PREFIX_BONUS;
    } else if (label.includes(phrase)) {
        score += LABEL_PHRASE_BONUS;
    }

    return score;
}

function scoreText(text: string, token: string, weight: number): number {
    const index = text.indexOf(token);
    if (index < 0) {
        return 0;
    }
    if (index === 0) {
        return weight * 3;
    }
    if (isWordStart(text, index)) {
        return weight * 2;
    }
    // A later occurrence may still start a word ("art" in "smart artplayer").
    let next = text.indexOf(token, index + 1);
    while (next >= 0) {
        if (isWordStart(text, next)) {
            return weight * 2;
        }
        next = text.indexOf(token, next + 1);
    }
    return weight;
}

function isWordStart(text: string, index: number): boolean {
    return !LETTER_OR_DIGIT.test(text.charAt(index - 1));
}
