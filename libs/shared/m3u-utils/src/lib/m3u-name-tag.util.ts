/**
 * Splits the leading country / language / quality tag off an M3U entry name.
 *
 * Providers put the tag in front of the real name in a handful of
 * interchangeable spellings — `TR:TRT 1`, `US| ESPN`, `UK: Sky Sports`,
 * `|EN| CNN`, `EN - BBC One`, `4K - Sicario` — and everything downstream
 * (display stripping, series identity, live-variant grouping) wants the same
 * answer about where the name actually starts.
 *
 * ## Why this is not folded into `title-normalization.util.ts`
 *
 * That module's `normalizeTitleKeys` has the same job for provider TITLES,
 * and it is tempting to unify the two. Do not. Its output is **persisted**:
 * it builds the VOD multi-source pin keys stored in `vod_source_pins`, and
 * the Electron DB worker runs it for cross-playlist title matching. Widening
 * its separator rules silently moves every stored pin key — an
 * upgrade-compatibility break for a feature unrelated to this one. This
 * module is deliberately a separate, non-persisted, entry-name-only rule.
 *
 * ## Shape, not vocabulary
 *
 * A tag is recognised by its SHAPE, not by a list of known country codes:
 * short, uppercase, and followed by a separator. That is what keeps
 * `Sky - Sports F1` and `Mission: Impossible - Fallout` intact while
 * stripping `EN - BBC One`. A vocabulary gate belongs to the live-variant
 * identity rule, which has different costs — there a wrong guess only
 * affects grouping, whereas here it rewrites what the user reads.
 */

/**
 * Dash separators. A bare `-` is absent on purpose: `T-Mobile TV` and
 * `US-CNN` are names, not tagged names.
 */
const DASH_SEPARATORS = [' - ', '- ', ' -'];

/**
 * The colon needs NO trailing space.
 *
 * This is the one rule that differs from the historical behaviour. Panels
 * routinely write the tag welded to the name (`TR:TRT 1 HD`, `DE:THE NAKED
 * GUN`), and requiring `': '` meant those were never recognised — on a real
 * 62k-entry playlist that is over 53k entries keeping a tag nobody asked to
 * see. The 2-3 character uppercase gate below is what makes dropping the
 * space safe: `Mission: Impossible` and `NCIS: LA` fail it on length, so
 * they are untouched.
 */
const COLON_SEPARATOR = ':';

/**
 * Before a dash a tag is either a compound ("4K-DE", "AR-SUBS", "4K-OSN+" —
 * the inner hyphen is the tag signal) or a plain 2-3 char code ("US", "4K").
 * A bare 4-5 char word before a spaced dash is a real title ("DUNE - Part
 * Two", "ALIEN - Covenant"), so it is not a tag. Every segment must contain
 * a letter, so numbers ("1917 - ...") are safe.
 */
const TAG_PREFIX_PATTERN =
    /^(?:(?=[0-9+]*[A-Z])[A-Z0-9+]{2,5}(?:-(?=[0-9+]*[A-Z])[A-Z0-9+]{2,6}){1,2}|(?=[0-9+]*[A-Z])[A-Z0-9+]{2,3})$/;

/** Colon tags stay 2-3 chars; longer acronyms are franchise titles. */
const COLON_TAG_PATTERN = /^(?=[0-9+]*[A-Z])[A-Z0-9+]{2,3}$/;

/** Leading punctuation to skip when the name opens with the separator. */
const LEADING_SEPARATOR = /^[^\p{L}\p{N}]+/u;

export interface M3uNameTagSplit {
    /** The stripped tag, or null when the name carries none. */
    readonly tag: string | null;
    /** The name with the tag removed, or the original when there is none. */
    readonly title: string;
}

interface SeparatorMatch {
    index: number;
    length: number;
}

/**
 * Finds the first tag separator and splits there.
 *
 * Only the leading tag is removed: if the separator appears again, the rest
 * of the name keeps it (`ES - A3 - Sports` → `A3 - Sports`). A split that
 * would leave nothing behind reports no tag, so a name that is only a tag
 * survives unchanged.
 */
export function splitM3uNameTag(
    name: string | null | undefined
): M3uNameTagSplit {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
        return { tag: null, title: trimmed };
    }

    const match = findTagSeparator(trimmed);
    if (!match) {
        return { tag: null, title: trimmed };
    }

    const tag = trimmed.slice(0, match.index).trim();
    const rest = trimmed.slice(match.index + match.length).trim();
    if (!rest) {
        return { tag: null, title: trimmed };
    }

    // A wrapped tag ("|DE| ARD") opens with the separator, so the first split
    // yields an empty prefix; the tag is in what follows.
    if (!tag) {
        return splitM3uNameTag(rest);
    }

    return { tag, title: rest };
}

function findTagSeparator(name: string): SeparatorMatch | null {
    let best: SeparatorMatch | null = null;

    // A pipe is conventionally only ever a tag separator, so unlike the dash
    // and the colon it needs no shape gate.
    const pipeIndex = name.indexOf('|');
    if (pipeIndex !== -1) {
        best = { index: pipeIndex, length: 1 };
    }

    for (const separator of [...DASH_SEPARATORS, COLON_SEPARATOR]) {
        const index = name.indexOf(separator);
        if (index === -1 || (best && best.index <= index)) continue;
        const pattern =
            separator === COLON_SEPARATOR
                ? COLON_TAG_PATTERN
                : TAG_PREFIX_PATTERN;
        if (!pattern.test(name.slice(0, index).trim())) continue;
        best = { index, length: separator.length };
    }

    return best;
}

/**
 * The name with any leading separator punctuation removed, for callers that
 * need to compare a tag against the position it occupies ("|EN| CNN").
 */
export function stripLeadingSeparator(name: string): string {
    return name.replace(LEADING_SEPARATOR, '');
}
