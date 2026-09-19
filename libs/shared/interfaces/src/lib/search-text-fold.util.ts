/**
 * Locale-invariant case fold for in-memory search filters (channel lists,
 * catalog and category filters, source and download lists). Pure function,
 * no Angular/Node dependencies.
 *
 * `toLowerCase()` alone is not enough for one visible input: the Turkish
 * dotted capital "İ" (U+0130) lower-cases to "i" plus a combining dot above
 * (U+0307), so `"İnşaat".toLowerCase().includes("inş")` is `false` even
 * though the two spellings are the same word (issue #609). Dropping the
 * U+0300–U+036F combining marks after folding removes that leftover dot and
 * makes decomposed input equal to its precomposed form; precomposed letters
 * (ç, ş, ü, é, ё, й) are outside that range and stay untouched.
 *
 * `toLocaleLowerCase()` is deliberately not used: under a Turkish or Azeri
 * OS locale it maps ASCII "I" to the dotless "ı", so the same list would
 * filter differently per machine. This mirrors `normalizeSqlSearchText` in
 * the Electron content search, so the desktop SQL search and the renderer
 * filters agree on what "the same title" means.
 */
export function foldSearchText(value: string): string {
    return value.toLowerCase().replace(/[̀-ͯ]/g, '');
}
