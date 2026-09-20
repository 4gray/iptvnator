/**
 * Locale-invariant case fold for in-memory search filters (channel lists,
 * catalog and category filters, source and download lists). Pure function,
 * no Angular/Node dependencies.
 *
 * `toLowerCase()` alone is not enough for one visible input: the Turkish
 * dotted capital "İ" (U+0130) lower-cases to "i" plus a combining dot above
 * (U+0307), so `"İnşaat".toLowerCase().includes("inş")` is `false` even
 * though the two spellings are the same word (issue #609).
 *
 * The fold therefore runs `toLowerCase()`, re-composes the result to NFC and
 * drops whatever combining marks are left. Composing first is what makes the
 * fold agree on canonically equivalent text: a provider title stored
 * decomposed ("e" + U+0301) and a query typed precomposed ("é") reach the
 * same string, and a Greek "Ά" lower-cases to a form NFC maps onto the same
 * "ά" the user types. Only marks that cannot compose survive to be stripped —
 * the dotted I's leftover dot among them — so precomposed letters (ç, ş, ü,
 * é, ё, й) are preserved and the fold stays accent-sensitive, exactly as the
 * filters were before. A lower-cased string of printable ASCII is already NFC
 * and carries no marks, which is the fast path taken by most titles.
 *
 * `toLocaleLowerCase()` is deliberately not used: under a Turkish or Azeri
 * OS locale it maps ASCII "I" to the dotless "ı", so the same list would
 * filter differently per machine.
 */
const COMBINING_MARKS_REGEXP = /[̀-ͯ]/g;
const NON_PRINTABLE_ASCII_REGEXP = /[^ -~]/;

export function foldSearchText(value: string): string {
    const lowered = value.toLowerCase();

    return NON_PRINTABLE_ASCII_REGEXP.test(lowered)
        ? lowered.normalize('NFC').replace(COMBINING_MARKS_REGEXP, '')
        : lowered;
}
