/**
 * Provider-title normalization shared by the renderer (TMDB matching,
 * catalog indexes) and the Electron DB worker (cross-playlist title
 * matching). Pure functions — no Angular/Node dependencies.
 */

import { SEASON_WORD_ALTERNATIVES } from './season-marker.util';

const QUALITY_TAGS = new Set([
    '4k',
    'uhd',
    'fhd',
    'hd',
    'sd',
    'hdr',
    'hevc',
    'h264',
    'h265',
    'x264',
    'x265',
    '480p',
    '720p',
    '1080p',
    '2160p',
    'multi',
    'multisub',
    'vostfr',
    'vf',
    'dubbed',
]);

/**
 * The pipe and the display lookalikes providers use interchangeably with it
 * (`¦`, `│`, fullwidth `｜`, …). They are visually identical to `|` in a
 * catalog, so a rule that reads only U+007C leaves the same tag stripped in
 * one playlist and welded to the title in another — and the two copies then
 * never match as the same film.
 *
 * Exported because `vod-source-language.util.ts` reads the same separator to
 * decide a row's language: one set, so the "is this a tag" answer cannot
 * differ between matching and display.
 */
export const PROVIDER_PIPE_CLASS = '[|¦│┃❘∣⏐⎪︱︳丨｜]';

/**
 * Wrapped tag at the very start of a provider title: "|DE| ARD",
 * "|MULTI| Fallout". The lookahead requires a letter in the tag so a
 * numeric fragment can never be treated as one.
 */
const WRAPPED_TAG_PREFIX = new RegExp(
    `^\\s*${PROVIDER_PIPE_CLASS}(?=[0-9+]*[A-Z])[A-Z0-9+]{2,5}${PROVIDER_PIPE_CLASS}\\s*`
);

/**
 * Leading channel/language prefix like "EN - ", "DE| ", "FR: ", including
 * compound provider/quality forms ("4K-DE - ", "AR-SUBS - ", "4K-OSN+ - ")
 * and longer pipe-tagged forms ("EXYU| ", "MULTI| ").
 * UPPERCASE-only on purpose: a case-insensitive match would amputate real
 * title words ("It: Chapter Two" → "Chapter Two"). Every segment must
 * contain a letter so numeric titles ("1917 - ...") are never tags.
 *
 * Separator strength gates how wide a single segment may be:
 *   - dash ("EN - "): compound OR 2–3 chars — a bare 4–5 char word before
 *     a spaced dash is a real title ("DUNE - Part Two", "ALIEN - Covenant")
 *   - pipe ("EXYU| "): compound OR 2–5 chars — a pipe is a strong tag signal
 *   - colon ("EN: "): 2–3 chars — longer acronyms are franchise titles
 *     ("NCIS: LA")
 *
 * The pipe branch alone does not require a space after the separator:
 * "|FR|VO|Le dernier empereur" welds the tag to the title, and no real title
 * begins with a short word immediately followed by a pipe.
 *
 * The UPPERCASE-only restriction stays on every branch, pipe included. It is
 * tempting to drop it there on the theory that nothing but a tag precedes a
 * pipe — 1.27M real catalog titles say otherwise, and in two ways at once:
 * "Akira | 1988" and "Coco | 2017" put the film's NAME before the pipe and
 * the year after it, and Russian catalogs write "Момо | Momo",
 * "Мумия (2026) | Lee Cronin's The Mummy" — the localized title, then the
 * original. Case-insensitivity (or a Cyrillic alphabet) turns every one of
 * those names into a "tag" and strips it; measured against that corpus it
 * corrupted 349 keys and rescued none.
 */
const SEG = '(?=[0-9+]*[A-Z])[A-Z0-9+]';
const COMPOUND_TAG = `${SEG}{2,5}(?:-${SEG}{2,6}){1,2}`;
const LANGUAGE_PREFIX = new RegExp(
    '^(?:' +
        `(?:${COMPOUND_TAG}|${SEG}{2,3})\\s*-\\s+` +
        `|(?:${COMPOUND_TAG}|${SEG}{2,5})\\s*${PROVIDER_PIPE_CLASS}\\s*` +
        `|${SEG}{2,3}\\s*:\\s+` +
        ')'
);

/**
 * Curated whitelist for TRAILING language/subtitle tags ("Fallout_eng",
 * "Breaking Bad-DE", "The Pitt (2025) ES"). Trailing stripping must be
 * vocabulary-gated: a pattern-only rule would amputate real endings —
 * roman numerals ("Rocky II"), acronyms ("Made in USA"), franchise
 * suffixes ("NCIS: LA"). US/USA/UK/LA are deliberately absent.
 */
const TRAILING_TAG_VOCABULARY = new Set([
    'AF',
    'AL',
    'ALB',
    'AR',
    'BY',
    'DE',
    'DUB',
    'EN',
    'ENG',
    'ES',
    'ESP',
    'EXYU',
    'FR',
    'FRA',
    'GE',
    'GR',
    'HU',
    'IN',
    'IR',
    'IS',
    'IT',
    'ITA',
    'KA',
    'KU',
    'LAT',
    'ML',
    'MSUB',
    'MULTI',
    'NL',
    'PL',
    'PT',
    'RO',
    'RU',
    'SC',
    'SE',
    'SUB',
    'SUBS',
    'SW',
    'TA',
    'TL',
    'TR',
    'TUR',
]);

/**
 * Vocabulary tags that are also common English hyphenated-word endings
 * ("drive-in", "plug-in"). Accepted only after a STRONG separator (bare
 * spaced/uppercase form), never in the weak joined-dash/underscore forms
 * where "X-in"/"X_in" reads as a title, not a tag.
 */
const WEAK_JOIN_EXCLUSIONS = new Set(['IN']);

/**
 * Language/region/provider codes observed in the LEADING position that the
 * trailing vocabulary has no reason to carry — a provider brands the front
 * of a title ("NRC - Sonic the Hedgehog", "TOP - When the Light Breaks"),
 * never the end of one.
 *
 * A separate set, because the same token answers the question differently at
 * each end. `LA` is the clearest case: it is a real prefix tag (590 tagged
 * titles) and it is already, deliberately, kept OUT of the trailing set —
 * where it ends 71 real titles ("Desastre LA", "Detroit NY LA"). Merging the
 * two lists would amputate those, plus "Les EX" and "Half CA", to rescue
 * three.
 *
 * Every entry is one the catalog proves, and only those: each prefixes
 * hundreds to thousands of ordinary lettered titles (NF 10544, EX 8177,
 * NRC 4961, TM 3538, AMZ 966, D+ 892, BL 826, LA 590, OSN 499, KD 467,
 * P+ 42 …). Opaque provider codes are in for the same reason the obvious
 * language codes are — what matters is that the catalog uses them as tags,
 * not that a reader can name them.
 *
 * Nothing is added on the theory that it "looks like a streaming service":
 * MAX and HULU would fit that theory, and "MAX - 2015" is a film. A tag
 * this list has not heard of costs one unmatched copy; a film name wrongly
 * listed here corrupts that film's identity everywhere.
 */
const PREFIX_ONLY_TAG_VOCABULARY = new Set([
    'AMZ',
    'BG',
    'BL',
    'BN',
    'BR',
    'CA',
    'CH',
    'CN',
    'D+',
    'DK',
    'EU',
    'EX',
    'ID',
    'IL',
    'ISR',
    'JP',
    'KD',
    'KN',
    'KO',
    'LA',
    'LT',
    'MA',
    'MY',
    'NF',
    'NRC',
    'OSN',
    'P+',
    'PH',
    'PK',
    'QC',
    'QFR',
    'SO',
    'SOM',
    'STH',
    'TG',
    'TH',
    'TM',
    'TOD',
    'TOP',
    'VO',
    'VP',
]);

/**
 * A leading token is provider metadata when either vocabulary knows it, or —
 * for compounds — when its FIRST segment does ("4K-FR", "AR-SUBS", "IN-KN",
 * "SO-EN"). Compound tags are open-ended (every panel invents its own
 * "4K-<lang>" pairing), so enumerating them would go stale against the next
 * catalog; the head is what carries the meaning. That head rule is also what
 * separates a compound tag from a hyphenated NAME: "INU-OH - 2022" and
 * "PC-4L - 2020" are films, and neither "INU" nor "PC" is a known tag.
 */
function isKnownPrefixTag(token: string): boolean {
    const upper = token.toUpperCase();
    const isKnown = (value: string) =>
        TRAILING_TAG_VOCABULARY.has(value) ||
        PREFIX_ONLY_TAG_VOCABULARY.has(value) ||
        QUALITY_TAGS.has(value.toLowerCase());

    if (isKnown(upper)) {
        return true;
    }

    const head = upper.split('-')[0];
    return head !== upper && isKnown(head);
}

/**
 * Separator the matched prefix ends with, plus any padding around it. Built
 * by alternation rather than by splicing `PROVIDER_PIPE_CLASS` open, so the
 * pipe set stays a black box its owner can reshape.
 */
const PREFIX_SEPARATOR_TAIL = new RegExp(
    `(?:[\\s\\-:]|${PROVIDER_PIPE_CLASS})+$`,
    'u'
);

const HAS_LETTER = /\p{L}/u;

/**
 * Whether any WORD survives the strip. A quality tag or a trailing language
 * tag does not count, because the pipeline drops both a few lines later —
 * testing the raw remainder instead lets them smuggle the strip through, and
 * the title then normalizes to a key it was never entitled to:
 *
 *   "|TA| RRR - HEVC"  the suffix IS the remainder → the EMPTY key
 *   "IF - 2024_sub"    "sub" reads as a word → the bare-year key "2024"
 *
 * Both are the identity collapse this guard exists to prevent — the first
 * one broader than a bare year, the second exactly it.
 *
 * Diacritics are not folded first on purpose: every tag in both sets is
 * ASCII, so an accented token is meaningful either way.
 */
/**
 * Decide the leading provider tag — but never strip one that is the film's
 * own NAME.
 *
 * The two shapes are structurally identical: "IT - 65 (2023)" is the Italian
 * copy of the film "65", while "AKA - 2023" is the film "AKA" followed by its
 * year. Both are 2–5 uppercase characters, a dash, and digits, so only the
 * token's MEANING can separate them — hence the vocabulary gate.
 *
 * The gate applies only when the strip would leave no real WORD behind, and
 * "no real word" is decided by running the REST OF THE PIPELINE and looking
 * at what actually comes out. That is the whole point of the design: every
 * later stage removes something, so any guard that re-implements their rules
 * is a list to keep in sync, and each omission is a silent bug —
 *
 *   "|TA| RRR - HEVC"     quality tag        → the EMPTY key
 *   "IF - 2024_sub"       underscore tag     → the bare year "2024"
 *   "CAT - 2022 S01"      season marker      → the bare year "2022"
 *   "AKA --xyz"           double-dash suffix → the EMPTY key
 *
 * All four are the identity collapse this guard exists to prevent, and all
 * four fall out of one question asked of the real output. A stage added later
 * is covered for free.
 *
 * Whenever a word does survive, the tag reading is safe ("XX - Some Title"
 * cannot be a title plus a year), and gating that path too would strand every
 * genuine tag the vocabulary has not heard of. Refusing costs a missed
 * cross-playlist match; stripping wrongly collapses the identity — measured
 * on the live catalog, AKA/BDE/BRO/OUT/WIL/IF all landed on the single key
 * "2023" and were offered to each other as alternative sources. A miss beats
 * a wrong match, so an unknown token keeps its title.
 */
function normalizeAfterLeadingTag(value: string): string {
    const match = value.match(LANGUAGE_PREFIX);
    if (!match) {
        return normalizeRest(value);
    }

    const stripped = normalizeRest(value.replace(LANGUAGE_PREFIX, ''));
    // Deliberately not `stripSeason`: its "never return empty" fallback would
    // report a lone season marker as a surviving word.
    if (HAS_LETTER.test(stripped.replace(SEASON_SUFFIX_PATTERN, ''))) {
        return stripped;
    }

    const token = match[0].replace(PREFIX_SEPARATOR_TAIL, '');
    return isKnownPrefixTag(token) ? stripped : normalizeRest(value);
}

const DOUBLE_DASH_SUFFIX = /[-–]{2}[A-Za-z]{2,5}\s*$/;
const UNDERSCORE_SUFFIX = /_([A-Za-z]{2,5})\s*$/;
const JOINED_DASH_SUFFIX = /-([A-Za-z]{2,5})\s*$/;
const TRAILING_TAG_SUFFIX = /\s([A-Z]{2,5})\s*$/;

/** Tag tokens are case-uniform; real title words are Capitalized. */
function isCaseUniform(token: string): boolean {
    return token === token.toLowerCase() || token === token.toUpperCase();
}

/**
 * A captured joined-dash/underscore token is provider metadata only when
 * it is a known vocabulary tag, case-uniform, and not one of the English
 * word-forming exclusions. This keeps "Mr_Robot", "Cowboy_Bebop",
 * "drive-in", and "Plug-in" intact while stripping "_eng", "-DE", "-it".
 */
function isJoinedTag(token: string): boolean {
    const upper = token.toUpperCase();
    return (
        TRAILING_TAG_VOCABULARY.has(upper) &&
        !WEAK_JOIN_EXCLUSIONS.has(upper) &&
        isCaseUniform(token)
    );
}

/** ES2015-safe trailing-whitespace trim (the lib target predates trimEnd). */
function trimRight(value: string): string {
    return value.replace(/\s+$/, '');
}

/**
 * Strip appended language/subtitle tags. Runs BEFORE lowercasing —
 * casing is the main false-positive guard: ALL-CAPS titles carry no
 * casing signal ("THE LAST OF US" must keep its "US"), so caps-gated
 * rules are skipped for them, and Capitalized endings ("Making It",
 * "Kick-It") never look like tags. Compound tags ("FR-EN") shed one
 * token per pass, so stripping repeats to a fixpoint.
 */
function stripTrailingTags(value: string): string {
    let result = value;
    for (let pass = 0; pass < 3; pass++) {
        const next = stripTrailingTagOnce(result);
        if (next === result) break;
        result = next;
    }
    return result;
}

function stripTrailingTagOnce(value: string): string {
    const result = trimRight(value);
    const hasLowercase = /\p{Ll}/u.test(result);

    // "The Last of Us--esp": no real title contains a double dash.
    if (DOUBLE_DASH_SUFFIX.test(result)) {
        return trimRight(result.replace(DOUBLE_DASH_SUFFIX, ''));
    }

    // "Fallout_eng" — but not "The_Last_of_Us" (underscores as spaces, only
    // strip a sole underscore) and not "Mr_Robot"/"Cowboy_Bebop" (the tail
    // must be a known tag, so the segment is real-title evidence otherwise).
    const underscore = result.match(UNDERSCORE_SUFFIX);
    if (
        underscore &&
        result.indexOf('_') === result.lastIndexOf('_') &&
        isJoinedTag(underscore[1])
    ) {
        return trimRight(result.replace(UNDERSCORE_SUFFIX, ''));
    }

    // "Breaking Bad-eng", "The Last of Us-DE" — but not "drive-in"/"Plug-in".
    // hasLowercase gates ALL-CAPS titles out (no casing signal to trust).
    const joined = result.match(JOINED_DASH_SUFFIX);
    if (joined && hasLowercase && isJoinedTag(joined[1])) {
        return trimRight(result.replace(JOINED_DASH_SUFFIX, ''));
    }

    const trailing = result.match(TRAILING_TAG_SUFFIX);
    if (trailing && hasLowercase && TRAILING_TAG_VOCABULARY.has(trailing[1])) {
        return trimRight(result.replace(TRAILING_TAG_SUFFIX, ''));
    }

    return result;
}

const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/;

/**
 * Release-year tag at the very end of a title ("The Matrix 1999"). Only
 * trailing years are stripped — an unanchored pattern would eat years that
 * are part of the title ("2001: A Space Odyssey" → "a space odyssey").
 */
const TRAILING_YEAR_PATTERN = /(?:^|\s)(19\d{2}|20\d{2})$/;

/**
 * Trailing season markers on series titles: "The Boys s05", "сезон 2",
 * plus number-first forms ("2 season", "Пацаны 2 сезон", "2nd Season" —
 * "2-й" normalizes to "2 й", hence the optional ordinal token). The
 * ordinal list carries NFD-decomposed forms too: this pattern runs after
 * diacritics stripping, which turns "й" into "и" ("2-й сезон" → "2 и
 * сезон"). Uses (?:^|\s) instead of \b — JS word boundaries are
 * ASCII-only and never fire next to Cyrillic letters.
 */
const SEASON_SUFFIX_PATTERN = new RegExp(
    '(?:^|\\s)(?:' +
        's\\d{1,2}' +
        `|(?:${SEASON_WORD_ALTERNATIVES})\\s*\\d{1,2}` +
        `|\\d{1,2}\\s*(?:st|nd|rd|th|й|и|я|ой|ои)?\\s+(?:${SEASON_WORD_ALTERNATIVES})` +
        ')$',
    'iu'
);

/**
 * Everything the pipeline does AFTER the leading-tag decision: trailing
 * tags, diacritics, case, sigma folding, punctuation, quality tags.
 *
 * Factored out so `normalizeAfterLeadingTag` can ask what a strip would
 * actually produce instead of predicting it. Cheap enough to run twice,
 * because the second run only happens for a title whose stripped form came
 * out with no word in it at all.
 */
function normalizeRest(value: string): string {
    return (
        stripTrailingTags(value)
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            // Greek Σ has two lowercase forms and `toLowerCase` picks by
            // position: "ΑΣ" becomes "ας" while an already-lowercase "ασ"
            // stays medial, so the same word reaches this line spelled two
            // ways. Both SQL tiers fold them together — SQLite's trigram
            // tokenizer does it natively, and the scan's GLOB classes do it in
            // `caseInsensitiveGlobPattern` — so without this the candidate is
            // admitted by the query and then thrown away by the confirmation.
            // Folding to the medial form is what Unicode case folding does.
            .replace(/ς/g, 'σ')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .split(' ')
            .filter((token) => token !== '' && !QUALITY_TAGS.has(token))
            .join(' ')
            .trim()
    );
}

/**
 * Portal series list titles carry season suffixes ("The Boys s05"); TMDB
 * knows only the show title. Never returns empty — a title that is nothing
 * but a season marker keeps it.
 */
const stripSeason = (value: string) =>
    value.replace(SEASON_SUFFIX_PATTERN, '').trim() || value;

/**
 * A provider title normalized on two tiers. Trailing years on provider
 * titles are ambiguous — usually a release tag ("The Matrix 1999") but
 * sometimes part of the title itself ("Blade Runner 2049") — so matching
 * must try the exact form first and only fall back to the year-stripped
 * form when the stripped year does not contradict the other side's year.
 */
export interface NormalizedTitleKeys {
    /** Fully normalized, trailing year KEPT ("blade runner 2049") */
    exact: string;
    /** Trailing year stripped ("blade runner"); equals `exact` if none */
    base: string;
    /** The trailing year removed in `base`, when there was one */
    trailingYear: number | null;
}

export function normalizeTitleKeys(
    raw: string | null | undefined
): NormalizedTitleKeys {
    if (!raw) {
        return { exact: '', base: '', trailingYear: null };
    }

    const cleaned = normalizeAfterLeadingTag(
        raw
            .replace(WRAPPED_TAG_PREFIX, '')
            // Inner classes exclude the opening delimiter too, so runaway
            // inputs like "[[[[[..." backtrack linearly (CodeQL js/polynomial-redos)
            .replace(/\[[^\][]*\]|\([^()]*\)|\{[^{}]*\}/g, ' ')
    );

    const exact = stripSeason(cleaned);

    // Trailing years are release tags ("The Matrix 1999"), but a year can
    // also BE the title ("2012") — never normalize down to an empty string.
    const yearMatch = cleaned.match(TRAILING_YEAR_PATTERN);
    const withoutYear = cleaned
        .replace(TRAILING_YEAR_PATTERN, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!yearMatch || !withoutYear) {
        return { exact, base: exact, trailingYear: null };
    }

    return {
        exact,
        base: stripSeason(withoutYear),
        trailingYear: Number(yearMatch[1]),
    };
}

export function normalizeTitle(raw: string | null | undefined): string {
    return normalizeTitleKeys(raw).base;
}

/**
 * True when a base-tier (year-stripped) title match is not contradicted by
 * the known years of both sides. Unknown years never block a match.
 */
export function titleYearsCompatible(
    a: number | null | undefined,
    b: number | null | undefined
): boolean {
    return (
        a === null ||
        a === undefined ||
        b === null ||
        b === undefined ||
        Math.abs(a - b) <= 1
    );
}

/** Extract a release year from a date string or from tags in a raw title */
export function extractYear(
    releaseDate: string | null | undefined,
    rawTitle?: string | null
): number | null {
    const fromDate = releaseDate?.match(YEAR_PATTERN)?.[0];
    if (fromDate) {
        return Number(fromDate);
    }

    const fromTitle = rawTitle?.match(YEAR_PATTERN)?.[0];
    return fromTitle ? Number(fromTitle) : null;
}

/** Bracketed release tag: "Dune (2021)", "Dune [2021]". */
const BRACKETED_YEAR_PATTERN = /[([{]\s*(19\d{2}|20\d{2})\s*[)\]}]/;

/**
 * The year a provider title states as a release TAG, never one that belongs to
 * the film's name.
 *
 * `extractYear` reads any year anywhere in the title, which is the right answer
 * where a year is only a search hint that scoring will confirm. It is the wrong
 * answer wherever the year becomes part of an IDENTITY: "2001: A Space Odyssey"
 * is not a 2001 film, and calling it one makes every genuine 1968 copy fail the
 * year gate — the movie then has no alternative sources at all — while its pin
 * key moves the moment enrichment supplies the real year.
 *
 * Only bracketed and trailing forms count. The trailing form stays ambiguous on
 * purpose ("Blade Runner 2049" is a title, not a tag); that is what the
 * `exact`/`base` two-tier match is for, and nothing here can settle it.
 */
export function releaseTagYear(
    rawTitle: string | null | undefined
): number | null {
    if (!rawTitle) {
        return null;
    }

    // Before `normalizeTitleKeys`, which strips bracketed segments wholesale
    // and would take the tag with them.
    const bracketed = rawTitle.match(BRACKETED_YEAR_PATTERN);
    return bracketed
        ? Number(bracketed[1])
        : normalizeTitleKeys(rawTitle).trailingYear;
}
