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
 * A `*…*` containment pattern matching `token` in any case, or `null` when the
 * token cannot be expressed safely.
 *
 * `null` is returned rather than a best-effort pattern for two reasons: a
 * metacharacter would silently turn into a wildcard, and a character whose case
 * mapping changes length (`ß` uppercases to `SS`) has no single-character class
 * that means the same thing. Both are rare enough that the caller's plain
 * substring test is a better answer than a subtly wrong pattern.
 */
export function caseInsensitiveGlobPattern(token: string): string | null {
    if (token === '' || GLOB_METACHARACTERS.test(token)) {
        return null;
    }

    let pattern = '*';
    for (const character of token) {
        const lower = character.toLowerCase();
        const upper = character.toUpperCase();

        if (lower === upper) {
            pattern += character;
            continue;
        }

        if (
            [...lower].length !== 1 ||
            [...upper].length !== 1 ||
            GLOB_METACHARACTERS.test(lower) ||
            GLOB_METACHARACTERS.test(upper)
        ) {
            return null;
        }

        pattern += `[${lower}${upper}]`;
    }

    return `${pattern}*`;
}
