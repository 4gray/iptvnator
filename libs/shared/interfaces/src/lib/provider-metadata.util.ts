/**
 * Readers for provider detail metadata (`get_vod_info`, Stalker VOD rows).
 *
 * Portals fill a field they have nothing for with a stand-in instead of
 * leaving it empty — `"N/A"` (in any case) or a lone `"-"` — and a detail
 * template that renders any truthy value then shows the stand-in as if it
 * were data: a `⭐ N/A` chip, an "N/A" director, an "N/A" plot. The detail
 * shell's contract is that missing data simply is not rendered, so these
 * readers turn every stand-in into "absent" where provider rows are MAPPED,
 * and templates keep plain truthiness guards instead of each learning the
 * list.
 *
 * Keep the list to stand-ins providers were actually seen sending: every
 * entry also erases a genuine value that happens to read the same.
 */
const PROVIDER_PLACEHOLDERS: ReadonlySet<string> = new Set(['n/a', '-']);

/**
 * Trimmed provider text, or `undefined` when it is blank or a placeholder.
 * Finite numbers are read as their text form; anything else is absent.
 */
export function readProviderText(value: unknown): string | undefined {
    const text =
        typeof value === 'string'
            ? value.trim()
            : typeof value === 'number' && Number.isFinite(value)
              ? String(value)
              : '';
    return text && !PROVIDER_PLACEHOLDERS.has(text.toLowerCase())
        ? text
        : undefined;
}

/**
 * The first candidate that carries real text. `a ?? b` would stop at a
 * placeholder (or a blank) and never reach the usable fallback behind it.
 */
export function firstProviderText(...values: unknown[]): string | undefined {
    for (const value of values) {
        const text = readProviderText(value);
        if (text !== undefined) {
            return text;
        }
    }
    return undefined;
}

/**
 * {@link readProviderText} for an IMDb / Kinopoisk score, where zero is a
 * placeholder too: both scales start at 1, so a `"0"` / `"0.0"` is the
 * panel's way of saying "unrated" (TMDB's `vote_average` of 0 is read the
 * same way by the enrichment merge).
 */
export function readProviderRating(value: unknown): string | undefined {
    const text = readProviderText(value);
    return text !== undefined && Number(text.replace(',', '.')) === 0
        ? undefined
        : text;
}
