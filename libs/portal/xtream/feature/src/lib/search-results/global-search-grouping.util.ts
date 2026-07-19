import { XtreamSearchResultItem } from '@iptvnator/portal/xtream/data-access';
import { stripCountryPrefix } from '@iptvnator/shared/m3u-utils';
import { extractYear, normalizeTitleKeys } from '@iptvnator/shared/interfaces';

/**
 * A set of provider results that are the same title/type under different
 * language, quality or provider tags ("DE| The Pitt", "4K-TR - The Pitt",
 * "The Pitt (2025)"). Collapsing them turns a flood of near-duplicate
 * cards into one entry the user can expand to pick a specific variant.
 */
export interface VariantGroup {
    /** Stable key: content type + normalized title (+ playlist/year). */
    key: string;
    /** Cleanest member title, used as the collapsed card label. */
    displayTitle: string;
    /** Best-ranked member with a poster — opened for a single variant. */
    representative: XtreamSearchResultItem;
    /** All members, in the original (ranked) order. */
    items: XtreamSearchResultItem[];
}

interface Bucket {
    bucketKey: string;
    members: { item: XtreamSearchResultItem; year: number | null }[];
}

/**
 * Group results that share a normalized title AND display type. Type is
 * part of the key so a movie and a series with the same name never merge.
 *
 * Because the normalized base drops the release year, a bucket is split by
 * year when it contains two or more distinct years — otherwise remakes
 * like "Dune (1984)" and "Dune (2021)" would collapse into one card. A
 * single (or absent) year keeps the whole bucket together, so the common
 * case where only some variants carry the year still collapses cleanly.
 *
 * `keyPrefix` scopes the group key (e.g. per playlist) so the same title
 * in two playlists expands independently. Order is preserved: groups
 * appear in first-seen order and members in their ranked order.
 */
export function groupResultsByVariant(
    items: readonly XtreamSearchResultItem[],
    getDisplayType: (item: XtreamSearchResultItem) => string,
    keyPrefix = ''
): VariantGroup[] {
    const buckets = new Map<string, Bucket>();
    const order: string[] = [];

    for (const item of items) {
        const type = getDisplayType(item);
        const base = normalizeTitleKeys(item.title).base;
        const bucketKey = base ? `${type}::${base}` : `${type}::id:${item.id}`;
        let bucket = buckets.get(bucketKey);
        if (!bucket) {
            bucket = { bucketKey, members: [] };
            buckets.set(bucketKey, bucket);
            order.push(bucketKey);
        }
        bucket.members.push({ item, year: extractYear(null, item.title) });
    }

    const groups: VariantGroup[] = [];
    for (const bucketKey of order) {
        const members = buckets.get(bucketKey)!.members;
        const distinctYears = new Set(
            members
                .map((m) => m.year)
                .filter((year): year is number => year !== null)
        );

        if (distinctYears.size < 2) {
            groups.push(
                buildGroup(
                    `${keyPrefix}${bucketKey}`,
                    members.map((m) => m.item)
                )
            );
            continue;
        }

        const byYear = new Map<string, XtreamSearchResultItem[]>();
        const yearOrder: string[] = [];
        for (const { item, year } of members) {
            const yearKey = year !== null ? String(year) : '';
            if (!byYear.has(yearKey)) {
                byYear.set(yearKey, []);
                yearOrder.push(yearKey);
            }
            byYear.get(yearKey)!.push(item);
        }
        for (const yearKey of yearOrder) {
            groups.push(
                buildGroup(
                    `${keyPrefix}${bucketKey}::${yearKey}`,
                    byYear.get(yearKey)!
                )
            );
        }
    }

    return groups;
}

function buildGroup(
    key: string,
    items: XtreamSearchResultItem[]
): VariantGroup {
    let representative = items[0];
    let displayTitle = stripCountryPrefix(items[0].title) || items[0].title;

    for (let index = 1; index < items.length; index++) {
        const item = items[index];
        // Prefer the shortest cleaned title — the least tag-polluted label
        // ("The Pitt" over "The Pitt (2025) DE").
        const cleaned = stripCountryPrefix(item.title) || item.title;
        if (cleaned.length < displayTitle.length) {
            displayTitle = cleaned;
        }
        // Keep the best-ranked member, but skip past leading posterless
        // clones so the collapsed card shows real artwork when any exists.
        if (!representative.poster_url && item.poster_url) {
            representative = item;
        }
    }

    return { key, displayTitle, representative, items };
}
