import { toXtreamRecentlyAddedTimestamp } from '@iptvnator/shared/interfaces';
/** Provider recency, never release year. Preserve the common epoch validity rules. */
export function xtreamCatalogTimestamp(
    raw: Record<string, unknown>,
    series: boolean
): number {
    const candidates = series ? [raw.added, raw.last_modified] : [raw.added];
    for (const value of candidates) {
        let date = value;
        if (
            typeof value === 'string' &&
            /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value)
        )
            date = Date.parse(value.replace(' ', 'T'));
        const timestamp = toXtreamRecentlyAddedTimestamp(date);
        if (timestamp) return timestamp;
    }
    return 0;
}
