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
    // Latin-1 Supplement through Latin Extended-B, PLUS Latin Extended
    // Additional — which is where Vietnamese lives (ố is U+1ED1). Stopping at
    // Latin Extended-B looks tidy and silently leaves a whole language out,
    // while the normalizer folds it perfectly well. The filter below decides
    // what actually belongs, so a range only has to be wide enough.
    const ranges: ReadonlyArray<[number, number]> = [
        [0x00c0, 0x024f],
        [0x1e00, 0x1eff],
    ];
    for (const [first, last] of ranges) {
        for (let codePoint = first; codePoint <= last; codePoint += 1) {
            addAccentedForm(byBase, String.fromCodePoint(codePoint));
        }
    }
    return byBase;
})();

/**
 * The forms a class MUST carry for one character: its own case pair, plus the
 * uppercase form's own lowercase.
 *
 * Kept as one function because it is also what decides which fold groups below
 * are worth storing — a group that adds nothing to this set is dead weight.
 */
function caseForms(character: string): Set<string> {
    const upper = character.toUpperCase();
    return new Set([
        character,
        character.toLowerCase(),
        upper,
        upper.toLowerCase(),
    ]);
}

/**
 * Every character that folds to the same uppercase, keyed by it.
 *
 * Derived by scanning the cased ranges once, exactly like `ACCENTED_BY_BASE`,
 * rather than tabulating the pairs by hand. A letter can have more lowercase
 * spellings than case mapping alone will reach from any one of them: Greek `Σ`
 * lowercases to `σ`, but a word-final sigma is written `ς` and is just as much
 * a lowercase of it, and neither `Σ` nor `σ` can arrive at `ς`. Grouping by the
 * shared uppercase reaches every spelling from every other one, and does it for
 * the whole alphabet instead of the one pair someone thought to write down.
 */
const CASE_FOLD_GROUPS = ((): Map<string, string[]> => {
    const byUpper = new Map<string, string[]>();
    // Wide enough to hold the cased scripts that appear in titles; the filter
    // below decides what actually earns a place. Greek Extended is in for
    // U+1FBE, whose uppercase is a plain Greek iota, and Cyrillic Extended-C
    // for the historic letterforms that fold onto В Д О С Т Ъ Ѣ.
    const ranges: ReadonlyArray<[number, number]> = [
        [0x0041, 0x024f],
        [0x0370, 0x03ff],
        [0x0400, 0x04ff],
        [0x1c80, 0x1c8f],
        [0x1e00, 0x1fff],
    ];
    for (const [first, last] of ranges) {
        for (let codePoint = first; codePoint <= last; codePoint += 1) {
            const character = String.fromCodePoint(codePoint);
            const upper = character.toUpperCase();
            // Both of these are really in the ranges above: 89 characters
            // uppercase to more than one code point (`ß` → `SS`, `ǰ`, `ΐ`),
            // which names no single class member and cannot key the map, and
            // `[`, `]` and `^` are letters' neighbours in Basic Latin. The
            // map's whole value is that anything in it is safe to put in a
            // class, so the filtering happens here rather than at every use.
            if (
                [...upper].length !== 1 ||
                GLOB_METACHARACTERS.test(character)
            ) {
                continue;
            }

            const members = byUpper.get(upper) ?? [];
            members.push(character);
            byUpper.set(upper, members);
        }
    }

    // Almost every group is just {upper, lower}, which `caseForms` already
    // returns from either one. Keeping only the groups that reach a spelling
    // it cannot leaves 24 entries out of 767 — and says so as a rule, so
    // widening a range later cannot quietly refill the map with pairs that
    // were never needed.
    return new Map(
        [...byUpper].filter(([, members]) =>
            members.some((member) =>
                members.some((from) => !caseForms(from).has(member))
            )
        )
    );
})();

/** Files one character under the plain ASCII letter it decomposes to. */
function addAccentedForm(
    byBase: Map<string, string[]>,
    character: string
): void {
    const base = character.normalize('NFD').replace(/\p{M}/gu, '');
    if (base.length !== 1 || !/[a-z]/i.test(base)) {
        return;
    }

    const key = base.toLowerCase();
    const forms = byBase.get(key) ?? [];
    forms.push(character);
    byBase.set(key, forms);
}

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
        const forms = caseForms(character);

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

        // Every character sharing this uppercase, which is what covers a
        // letter spelled more than one way in lower case. Case mapping alone
        // only reaches the second spelling from the second spelling: `ς` finds
        // `Σ` and `σ`, while a request for `ΑΣ` or `ασ` never arrives at `ς`
        // and missed a stored `Ας`. Every member of the group is a single
        // code point and class-safe by construction.
        for (const member of CASE_FOLD_GROUPS.get(character.toUpperCase()) ??
            []) {
            forms.add(member);
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
