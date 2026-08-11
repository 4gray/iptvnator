import { PROVIDER_PIPE_CLASS } from './title-normalization.util';

/**
 * Language prefixes for VOD multi-source rows.
 *
 * Panels rarely state a spoken language as a fact; what they do instead is
 * prefix stream titles ("EN| Movie") and category names ("EN | Netflix") with
 * a short tag. Everything here is therefore a GUESS by construction: it feeds
 * the browse filter and the copy-row chips, and is structurally excluded from
 * ranking and failover (`factualOnly` never reads it).
 *
 * Three tiers of strictness, matched to each form's noise profile:
 *
 * - The PIPE title form is permissive, as it always has been. A tag before a
 *   pipe in a MOVIE title is overwhelmingly a language — titles do not start
 *   with "VIP |" — and tightening the legacy form would drop filter options
 *   that work today.
 * - The BRACKET and DASH title forms are gated by `isKnownLanguageTag`. They
 *   are new (nothing to regress) and their prefixes skew toward quality and
 *   rip tags — "[HD] Dune", "NEW - Dune" — which would not only pollute the
 *   select but, since a title prefix outranks the category language, mask a
 *   real one and get the row excluded by the very filter meant to find it.
 * - Category names are noisiest: "NEW | 2024", "TOP | 250" and "VIP | Cinema"
 *   are everyday category shapes, and `new`, `top` and `hot` are even real
 *   ISO 639-3 codes, so a prefix read off a category always passes
 *   `isKnownLanguageTag`. Empty beats wrong: an unrecognized tag yields no
 *   language rather than a wrong filter option.
 */

/**
 * The pipe and its display lookalikes, shared with title normalization so
 * that what counts as a tag separator here is exactly what counts as one
 * when two copies are matched as the same film.
 */
const PIPE = PROVIDER_PIPE_CLASS;

/**
 * A candidate language token: 2–4 letters of ONE script, or the `MULTI`
 * marker panels use for multi-audio releases. Single-script on purpose —
 * a mixed-script "word" before a pipe is decoration, not a tag. Digits are
 * excluded, so "4K |" never reads as a language.
 */
const TOKEN = '(?:[A-Za-z]{2,4}|[А-Яа-яЁё]{2,4}|[Mm][Uu][Ll][Tt][Ii])';

/** `EN| Movie`, `ru │ Фильм`, `MULTI ¦ Movie` — any case before a pipe. */
const PIPE_FORM = new RegExp(`^\\s*(${TOKEN})\\s*${PIPE}`);

/**
 * `[EN] Movie`, `(RU) Фильм` — a bracketed tag at the very start.
 *
 * The two bracket styles are separate alternatives rather than one class of
 * openers and one of closers: the latter pairs them independently, so a
 * malformed `[EN)` would be read as a tag.
 */
const BRACKET_FORM = new RegExp(
    `^\\s*(?:\\[\\s*(${TOKEN})\\s*\\]|\\(\\s*(${TOKEN})\\s*\\))`
);

/**
 * `EN - Movie` — dash-separated, and deliberately stricter than the pipe
 * form: the tag must be ALL uppercase and the dash spaced on both sides.
 * Dashes are ordinary title punctuation ("X-Men", "Up - the movie"), so a
 * lowercase or unspaced form is a title, not a tag.
 */
const DASH_FORM = new RegExp(
    `^\\s*((?:[A-Z]{2,4}|[А-ЯЁ]{2,4}|MULTI))\\s+[-–—]\\s+`
);

/**
 * `EN| Night of the Living Dead` → `EN`.
 *
 * The provider's language convention for stream titles, in the three shapes
 * seen in the wild: tag-before-pipe (including Unicode pipe lookalikes),
 * bracketed tag, and uppercase tag before a spaced dash. Anything longer than
 * four letters is a word that happens to precede a separator, not a language.
 *
 * Only the pipe form is taken at its word; a bracket or dash match must also
 * name a KNOWN language, because those positions are where quality and rip
 * tags live ("[HD]", "[CAM]") — see the tier rationale in the file header.
 */
export function titleLanguagePrefix(
    rawTitle: string | null | undefined
): string | null {
    const title = rawTitle ?? '';

    const pipe = capturedTag(PIPE_FORM.exec(title));
    if (pipe) {
        return pipe.toUpperCase();
    }

    const gated =
        capturedTag(BRACKET_FORM.exec(title)) ??
        capturedTag(DASH_FORM.exec(title));
    return gated && isKnownLanguageTag(gated) ? gated.toUpperCase() : null;
}

/**
 * The tag out of whichever alternative matched. Read positionally rather
 * than as group 1, because a form with several alternatives (brackets) has
 * one group per alternative and only one of them is filled.
 */
function capturedTag(match: RegExpExecArray | null): string | null {
    return match?.slice(1).find((group) => group !== undefined) ?? null;
}

/**
 * `Intl.DisplayNames` is ES2021 and this workspace compiles against the
 * es2018 lib, so it is reached through a narrow shim (the same pattern
 * `Intl.Locale` uses in the metadata util). Absent — which no supported
 * runtime actually is — two-letter validation declines rather than guesses.
 */
const DisplayNamesCtor = (
    Intl as unknown as {
        DisplayNames?: new (
            locales: string[],
            options: { type: string; fallback: string }
        ) => { of(code: string): string | undefined };
    }
).DisplayNames;

let languageNames: { of(code: string): string | undefined } | null | undefined;

/**
 * Whether a two-letter token is an assigned ISO 639-1 code.
 *
 * With `fallback: 'code'`, `DisplayNames.of()` answers a real language with
 * its name ("en" → "English") and echoes an unassigned code back unchanged
 * ("hd" → "hd") — so "name differs from code" is precisely "this language
 * exists". The two-letter space is safe for this trick; the three-letter
 * space is NOT (ISO 639-3 assigns `new`, `top` and `hot`), which is why
 * longer tokens go through the curated list instead.
 */
function isAssignedTwoLetterCode(lower: string): boolean {
    if (!DisplayNamesCtor) {
        return false;
    }

    try {
        languageNames ??= new DisplayNamesCtor(['en'], {
            type: 'language',
            fallback: 'code',
        });
        const name = languageNames.of(lower);
        return typeof name === 'string' && name.toLowerCase() !== lower;
    } catch {
        // Structurally invalid tag, or a runtime without language data —
        // declining beats guessing.
        return false;
    }
}

/**
 * Three-and-more-letter tags panels actually use, plus the Cyrillic
 * shorthands `Intl` cannot validate. Curated rather than derived from ISO
 * 639-2/3: those registries assign codes to `new`, `top` and `hot`, so
 * validating against them would turn everyday category prefixes into
 * languages.
 */
const KNOWN_LONG_TAGS = new Set([
    // ISO 639-2 pairs (B/T) and common panel spellings, Latin script
    'eng',
    'rus',
    'ukr',
    'bel',
    'kaz',
    'ger',
    'deu',
    'fra',
    'fre',
    'spa',
    'esp',
    'lat',
    'ita',
    'por',
    'tur',
    'ara',
    'pol',
    'nld',
    'dut',
    'swe',
    'nor',
    'dan',
    'fin',
    'gre',
    'ell',
    'hun',
    'cze',
    'ces',
    'svk',
    'slo',
    'srb',
    'srp',
    'hrv',
    'cro',
    'bul',
    'ron',
    'rum',
    'alb',
    'sqi',
    'mkd',
    'bos',
    'heb',
    'hin',
    'vie',
    'tha',
    'kor',
    'jpn',
    'chi',
    'zho',
    'per',
    'fas',
    'aze',
    'kat',
    'geo',
    'hye',
    'arm',
    'uzb',
    'lit',
    'lav',
    'est',
    'multi',
    // Cyrillic shorthands
    'ру',
    'уа',
    'рус',
    'укр',
    'бел',
    'каз',
    'анг',
    'англ',
    'нем',
    'фра',
    'исп',
    'ита',
    'пол',
    'тур',
    'узб',
    'арм',
    'груз',
    'азе',
]);

/**
 * Whether a parsed prefix names a language, as opposed to any short word a
 * category happens to start with.
 */
export function isKnownLanguageTag(tag: string): boolean {
    const lower = tag.toLowerCase();
    if (KNOWN_LONG_TAGS.has(lower)) {
        return true;
    }
    return /^[a-z]{2}$/.test(lower) && isAssignedTwoLetterCode(lower);
}

/**
 * The language a stream's categories agree on, or null.
 *
 * A stream usually sits in several categories of one playlist ("EN | Netflix"
 * and "EN | Action"), and the aggregation is what makes the answer honest:
 * every prefixed category must name the SAME language, and that language must
 * pass `isKnownLanguageTag`. Categories without a recognized language prefix
 * abstain rather than veto — "EN | Netflix" plus "Netflix 4K" still reads EN,
 * while "EN | Netflix" plus "DE | Cinema" is a conflict and yields nothing.
 */
export function unambiguousCategoryLanguage(
    categoryNames: readonly (string | null | undefined)[] | null | undefined
): string | null {
    if (!categoryNames?.length) {
        return null;
    }

    let language: string | null = null;
    for (const name of categoryNames) {
        const prefix = titleLanguagePrefix(name);
        if (!prefix || !isKnownLanguageTag(prefix)) {
            continue;
        }
        if (language !== null && language !== prefix) {
            return null;
        }
        language = prefix;
    }
    return language;
}

/**
 * The language shown and filtered on for one source row.
 *
 * The stream's own title prefix is the more specific signal and wins; the
 * category-derived language stands in only when the title says nothing. Both
 * are guesses — this feeds the filter select and the copy-row chip, never a
 * ranking decision.
 */
export function vodSourceLanguage(source: {
    rawTitle?: string | null;
    categoryLanguage?: string | null;
}): string | null {
    return (
        titleLanguagePrefix(source.rawTitle) ?? source.categoryLanguage ?? null
    );
}
