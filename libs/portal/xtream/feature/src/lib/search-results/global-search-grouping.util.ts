import { XtreamSearchResultItem } from '@iptvnator/portal/xtream/data-access';
import { stripCountryPrefix } from '@iptvnator/shared/m3u-utils';
import { normalizeTitleKeys } from '@iptvnator/shared/interfaces';

/**
 * A set of provider results that are the same title/type under different
 * language, quality or provider tags ("DE| The Pitt", "4K-TR - The Pitt",
 * "The Pitt (2025)"). Collapsing them turns a flood of near-duplicate
 * cards into one entry the user can expand to pick a specific variant.
 */
export interface VariantGroup {
    /** Stable key: content type + normalized title (or a unique fallback). */
    key: string;
    /** Cleanest member title, used as the collapsed card label. */
    displayTitle: string;
    /** Best-ranked member — opened when the group has a single variant. */
    representative: XtreamSearchResultItem;
    /** All members, in the original (ranked) order. */
    items: XtreamSearchResultItem[];
}

/**
 * Group results that share a normalized title AND display type. Type is
 * part of the key so a movie and a series with the same name never merge.
 * Items whose title normalizes to an empty key (rare) each keep their own
 * group so they are never silently collapsed together. Order is preserved:
 * groups appear in first-seen order and members in their ranked order.
 */
export function groupResultsByVariant(
    items: readonly XtreamSearchResultItem[],
    getDisplayType: (item: XtreamSearchResultItem) => string
): VariantGroup[] {
    const groups = new Map<string, VariantGroup>();

    for (const item of items) {
        const type = getDisplayType(item);
        const base = normalizeTitleKeys(item.title).base;
        const key = base ? `${type}::${base}` : `${type}::id:${item.id}`;
        const cleaned = stripCountryPrefix(item.title) || item.title;

        const existing = groups.get(key);
        if (existing) {
            existing.items.push(item);
            // Prefer the shortest cleaned title — it is the least
            // tag-polluted label ("The Pitt" over "The Pitt (2025) DE").
            if (cleaned.length < existing.displayTitle.length) {
                existing.displayTitle = cleaned;
            }
        } else {
            groups.set(key, {
                key,
                displayTitle: cleaned,
                representative: item,
                items: [item],
            });
        }
    }

    return [...groups.values()];
}
