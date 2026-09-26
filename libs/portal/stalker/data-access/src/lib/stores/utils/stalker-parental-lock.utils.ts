import { ALL_CATEGORIES_WITHHELD } from '@iptvnator/shared/interfaces';
import type { StalkerContentType } from '../stalker-store.contracts';

/** Minimal item shape the parental lock needs: the category a row belongs to. */
export interface StalkerLockableItem {
    tv_genre_id?: string | number;
    category_id?: string | number;
    id?: string | number;
    stream_id?: string | number;
    movie_id?: string | number;
    series_id?: string | number;
    cmd?: string;
    name?: string;
}

/**
 * The key the paging bookkeeping records a withheld row under. Stalker rows
 * carry their id in one of several fields; keying every id-less row under
 * `''` would count only the first of them as new, and a page of new locked
 * rows would then look like a stalled portal and end paging short of later
 * visible matches.
 */
export function stalkerWithheldRowKey(item: StalkerLockableItem): string {
    const id = item.id ?? item.stream_id ?? item.movie_id ?? item.series_id;
    if (id !== undefined && id !== null && String(id) !== '') {
        return `id:${String(id)}`;
    }
    return `row:${String(item.cmd ?? item.name ?? '')}`;
}

/**
 * Whether an item belongs to one of the withheld categories. Live and radio
 * rows carry their genre in `tv_genre_id`; VOD and series rows carry
 * `category_id`. Only matters for portal-wide lists ("All" and search),
 * since a withheld category can never be selected on its own.
 */
export function isStalkerItemWithheld(
    item: StalkerLockableItem,
    contentType: StalkerContentType,
    withheldCategoryIds: ReadonlySet<string>
): boolean {
    if (withheldCategoryIds.size === 0) {
        return false;
    }
    const categoryId =
        contentType === 'itv' || contentType === 'radio'
            ? item.tv_genre_id
            : item.category_id;
    if (categoryId === undefined || categoryId === null) {
        // A row without a genre is visible under a normal lock set but not
        // in fail-closed mode: while the locks are unknown, "no genre" must
        // not become the one row the withheld catalog still shows.
        return withheldCategoryIds === ALL_CATEGORIES_WITHHELD;
    }
    return withheldCategoryIds.has(String(categoryId));
}

export function withoutWithheldStalkerItems<T extends StalkerLockableItem>(
    items: T[],
    contentType: StalkerContentType,
    withheldCategoryIds: ReadonlySet<string>
): T[] {
    if (withheldCategoryIds.size === 0) {
        return items;
    }
    return items.filter(
        (item) => !isStalkerItemWithheld(item, contentType, withheldCategoryIds)
    );
}
