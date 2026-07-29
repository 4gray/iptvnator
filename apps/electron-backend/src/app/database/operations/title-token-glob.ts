/**
 * Case-insensitive GLOB patterns for tokens SQLite cannot fold itself.
 *
 * `LOWER()` in stock SQLite is ASCII-only — `LOWER('Он')` is `'Он'` — so a
 * Cyrillic or Greek token can never be folded in SQL. GLOB character classes,
 * however, are NOT ASCII-only: `patternCompare` reads them as UTF-8 code
 * points, so `'Он' GLOB '*[Оо][Нн]*'` is true. Folding the case in JavaScript,
 * where Unicode case mapping is real, and handing SQLite one class per
 * character gets the match SQL cannot compute on its own.
 */

/**
 * GLOB's own metacharacters. SQLite has no escape character in GLOB patterns
 * (only the `[*]` class form), so a token containing one of these is left to
 * the caller's substring fallback rather than escaped by hand.
 */
const GLOB_METACHARACTERS = /[*?[\]^-]/;

/**
 * Every accented Latin letter, bucketed by the plain letter it folds to.
 *
 * Derived rather than tabulated: decomposing a character and dropping its
 * combining marks IS the definition of the base letter, so this cannot drift
 * out of step with `normalizeTitleKeys`, which folds the same way.
 */
const ACCENTED_BY_BASE = ((): Map<string, string[]> => {
    const byBase = new Map<string, string[]>();
    // Latin-1 Supplement through Latin Extended-B, which is where the accented
    // forms of ASCII letters live.
    for (let codePoint = 0xc0; codePoint <= 0x24f; codePoint += 1) {
        const character = String.fromCodePoint(codePoint);
        const base = character.normalize('NFD').replace(/\p{M}/gu, '');
        if (base.length !== 1 || !/[a-z]/i.test(base)) {
            continue;
        }

        const key = base.toLowerCase();
        const forms = byBase.get(key) ?? [];
        forms.push(character);
        byBase.set(key, forms);
    }
    return byBase;
})();

/**
 * A `*…*` containment pattern matching `token` in any case, or `null` when the
 * token cannot be expressed safely.
 *
 * `null` is returned rather than a best-effort pattern for two reasons: a
 * metacharacter would silently turn into a wildcard, and a character whose case
 * mapping changes length (`ß` uppercases to `SS`) has no single-character class
 * that means the same thing. Both are rare enough that the caller's plain
 * substring test is a better answer than a subtly wrong pattern.
 */
export function caseInsensitiveGlobPattern(
    token: string,
    options: { foldDiacritics?: boolean } = {}
): string | null {
    const body = caseInsensitiveGlobBody(token, options);
    return body === null ? null : `*${body}*`;
}

/**
 * The class sequence alone, for callers that supply their own surroundings —
 * the scan's word-boundary form needs `[^a-z0-9]` on each side rather than a
 * wildcard.
 */
export function caseInsensitiveGlobBody(
    token: string,
    options: { foldDiacritics?: boolean } = {}
): string | null {
    if (token === '' || GLOB_METACHARACTERS.test(token)) {
        return null;
    }

    let pattern = '';
    for (const character of token) {
        const upper = character.toUpperCase();
        // Going back down from the uppercase form catches letters with more
        // than one lowercase spelling: Greek Σ lowercases to σ, but ς is an
        // equally valid lowercase of it, and a class built only from the
        // character in hand would know just one of the two.
        const forms = new Set([
            character,
            character.toLowerCase(),
            upper,
            upper.toLowerCase(),
        ]);

        // These are the forms the pattern MUST carry, so one it cannot express
        // means there is no honest pattern to build.
        if (
            [...forms].some(
                (form) =>
                    [...form].length !== 1 || GLOB_METACHARACTERS.test(form)
            )
        ) {
            return null;
        }

        // A normalized token has already had its diacritics folded away, so
        // "ca" has to be able to find a stored "Ça" — otherwise discovery runs
        // one way only, depending on which playlist happens to be open.
        //
        // These are additions, never requirements: an accented form whose own
        // case mapping is multi-character (ǰ uppercases to two code points)
        // is simply left out, rather than costing the whole token its pattern.
        if (options.foldDiacritics) {
            const accents = ACCENTED_BY_BASE.get(character.toLowerCase()) ?? [];
            for (const accented of accents) {
                for (const form of [
                    accented,
                    accented.toUpperCase(),
                    accented.toLowerCase(),
                ]) {
                    if (
                        [...form].length === 1 &&
                        !GLOB_METACHARACTERS.test(form)
                    ) {
                        forms.add(form);
                    }
                }
            }
        }

        if (forms.size === 1) {
            pattern += character;
            continue;
        }

        pattern += `[${[...forms].join('')}]`;
    }

    return pattern;
}
