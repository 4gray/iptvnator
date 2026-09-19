export type CategorySearchMode = 'any' | 'all';

export function normalizeCategorySearch(value: string): string {
    return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function normalizeCategorySearchTerm(value: string): string {
    return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function withoutExclusionPrefix(term: string): string {
    return term.startsWith('-') ? term.slice(1) : term;
}

/**
 * Spaces separate keywords; quotes preserve a multi-word phrase. A leading
 * minus sign is preserved so callers can treat `-term` as an exclusion.
 */
export function categorySearchTerms(query: string): string[] {
    const terms: string[] = [];
    let index = 0;

    while (index < query.length) {
        while (/[\s,]/u.test(query[index] ?? '')) index++;
        if (index >= query.length) break;

        const excluded = query[index] === '-';
        if (excluded) {
            index++;
            while (/\s/u.test(query[index] ?? '')) index++;
        }

        const quoted = query[index] === '"';
        if (quoted) index++;
        const start = index;
        while (
            index < query.length &&
            (quoted ? query[index] !== '"' : !/[\s,]/u.test(query[index] ?? ''))
        ) {
            index++;
        }

        const rawValue = query.slice(start, index);
        const value = quoted ? rawValue : rawValue.trim();
        if (quoted && query[index] === '"') index++;
        if (value.trim()) terms.push(`${excluded ? '-' : ''}${value}`);
    }
    const seen = new Set<string>();
    return terms.filter((term) => {
        const key = normalizeCategorySearchTerm(term);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function serializeCategorySearch(terms: readonly string[]): string {
    return terms
        .map((term) => (/[\s,]/.test(term) ? `"${term}"` : term))
        .join(' ');
}

/** Compile once per query, not once per category. Names are normalized by callers. */
export function categorySearchPredicate(
    query: string,
    exclusions = '',
    mode: CategorySearchMode = 'all'
): (normalizedName: string) => boolean {
    const inlineTerms = categorySearchTerms(query);
    const included = inlineTerms
        .filter((term) => !term.startsWith('-'))
        .map(normalizeCategorySearchTerm);
    const excluded = [
        ...categorySearchTerms(exclusions).map(withoutExclusionPrefix),
        ...inlineTerms
            .filter((term) => term.startsWith('-') && term.length > 1)
            .map(withoutExclusionPrefix),
    ].map(normalizeCategorySearchTerm);
    return (name) =>
        !excluded.some((term) => name.includes(term)) &&
        (included.length === 0 ||
            (mode === 'all'
                ? included.every((term) => name.includes(term))
                : included.some((term) => name.includes(term))));
}
