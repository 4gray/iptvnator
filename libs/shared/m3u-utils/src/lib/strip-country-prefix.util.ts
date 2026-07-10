const SEPARATORS = [' | ', '| ', ' |', '|', ' - ', '- ', ' -'];

/**
 * Strip country / group prefixes from channel names.
 *
 * Finds the first occurrence of a common separator like ` | ` or ` - `
 * and returns everything to its right.  Only the prefix is removed —
 * if the separator appears multiple times, only the first match counts.
 *
 * Examples:
 *   "US | CNN"         → "CNN"
 *   "UK - BBC One"     → "BBC One"
 *   "FR|TF1"           → "TF1"
 *   "ES - A3 - Sports" → "A3 - Sports"
 *   "BBC One"          → "BBC One"   (no separator)
 */
export function stripCountryPrefix(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return trimmed;

    let bestIndex = -1;
    let bestSep = '';

    for (const sep of SEPARATORS) {
        const idx = trimmed.indexOf(sep);
        if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
            bestIndex = idx;
            bestSep = sep;
        }
    }

    if (bestIndex === -1) {
        return trimmed;
    }

    return trimmed.slice(bestIndex + bestSep.length).trim();
}
