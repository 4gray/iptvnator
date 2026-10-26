import { normalizeTitleKeys } from '@iptvnator/shared/interfaces';

/** Keep literal partial searches and admit equivalent punctuation/diacritics. */
export function catalogTitleMatcher(query: string): (title: string) => boolean {
    const literal = query.toLowerCase();
    const normalized = normalizeTitleKeys(query).exact;
    return (title) =>
        title.toLowerCase().includes(literal) ||
        (!!normalized && normalizeTitleKeys(title).exact.includes(normalized));
}
