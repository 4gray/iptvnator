import type { StalkerContentType } from '../stalker-store.contracts';

/** Minimal item shape the parental lock needs: the category a row belongs to. */
export interface StalkerLockableItem {
    tv_genre_id?: string | number;
    category_id?: string | number;
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
    return (
        categoryId !== undefined &&
        categoryId !== null &&
        withheldCategoryIds.has(String(categoryId))
    );
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
