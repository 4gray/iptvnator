/**
 * Dash/colon separators only count when the prefix looks like a short
 * country/group tag — they routinely appear inside real channel names
 * ("Sky - Sports F1", "Discovery - Science"). Pipes are conventionally
 * used only as tag separators, so they always count.
 *
 * Before a dash a tag is either a compound ("4K-DE", "AR-SUBS", "4K-OSN+"
 * — the inner hyphen is the tag signal) or a plain 2–3 char code ("US",
 * "4K"). A bare 4–5 char word before a spaced dash is a real title
 * ("DUNE - Part Two", "ALIEN - Covenant"), so it is not a tag. Colon tags
 * stay 2–3 chars — longer acronyms are franchise titles ("NCIS: LA").
 * Every segment must contain a letter so numbers ("1917 - ...") are safe.
 */
const DASH_SEPARATORS = [' - ', '- ', ' -'];
const COLON_SEPARATOR = ': ';
const TAG_PREFIX_PATTERN =
    /^(?:(?=[0-9+]*[A-Z])[A-Z0-9+]{2,5}(?:-(?=[0-9+]*[A-Z])[A-Z0-9+]{2,6}){1,2}|(?=[0-9+]*[A-Z])[A-Z0-9+]{2,3})$/;
const COLON_TAG_PATTERN = /^(?=[0-9+]*[A-Z])[A-Z0-9+]{2,3}$/;

interface SeparatorMatch {
    index: number;
    length: number;
}

/**
 * Strip country / group prefixes from channel names.
 *
 * Finds the first tag separator and returns everything to its right.
 * Only the prefix is removed — if the separator appears multiple times,
 * only the first match counts. If stripping would leave an empty name,
 * the original (trimmed) name is returned instead.
 *
 * Examples:
 *   "US | CNN"           → "CNN"
 *   "UK - BBC One"       → "BBC One"
 *   "FR|TF1"             → "TF1"
 *   "|DE| ARD"           → "ARD"
 *   "US: CNN"            → "CNN"
 *   "ES - A3 - Sports"   → "A3 - Sports"
 *   "Sky - Sports F1"    → "Sky - Sports F1"  (prefix is not a short tag)
 *   "BBC One"            → "BBC One"          (no separator)
 *   "US | "              → "US |"             (stripping would leave nothing)
 */
export function stripCountryPrefix(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return trimmed;

    const match = findTagSeparator(trimmed);
    if (!match) return trimmed;

    const prefix = trimmed.slice(0, match.index).trim();
    const stripped = trimmed.slice(match.index + match.length).trim();
    if (!stripped) return trimmed;

    // A leading separator ("|DE| ARD") strips nothing by itself — retry on
    // the remainder so the actual tag segment is removed too.
    return prefix ? stripped : stripCountryPrefix(stripped);
}

/**
 * Settings-aware wrapper for display bindings: strips the prefix only when
 * the `stripCountryPrefix` setting is enabled, and normalizes nullish names
 * to an empty string.
 */
export function applyChannelNameStrip(
    name: string | null | undefined,
    enabled: boolean | null | undefined
): string {
    const raw = name ?? '';
    return enabled ? stripCountryPrefix(raw) : raw;
}

function findTagSeparator(name: string): SeparatorMatch | null {
    let best: SeparatorMatch | null = null;

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
