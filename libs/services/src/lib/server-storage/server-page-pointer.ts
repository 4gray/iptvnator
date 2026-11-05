import type { UserDataStorage } from '../user-data-storage';

/**
 * The tab's pointer to its page load, in `sessionStorage` (one per tab,
 * kept on reload): a reload finds the writes the page loads before it
 * saved.
 */
export const PAGE_KEY = 'iptvnator-server:page';

/**
 * Records `page` as the tab's current page load and returns the ones
 * before it: the last page load (a reload, whose saved writes this page
 * takes over), then, oldest first, older ones whose copies a page load
 * kept because storage refused its own (`keepPages`).
 */
export function swapPage(
    tabStore: UserDataStorage,
    instanceId: string,
    page: string
): string[] {
    try {
        const previous = tabStore.getItem(`${PAGE_KEY}:${instanceId}`);
        tabStore.setItem(`${PAGE_KEY}:${instanceId}`, page);
        return previous ? pageList(previous) : [];
    } catch {
        return [];
    }
}

/**
 * The tab's pointer names `page` and the older page loads whose saved
 * copies it still keeps: a reload before this page saved its own copy must
 * find them too, as their registry records may be missing.
 */
export function keepPages(
    tabStore: UserDataStorage,
    instanceId: string,
    page: string,
    kept: readonly string[]
): void {
    try {
        tabStore.setItem(
            `${PAGE_KEY}:${instanceId}`,
            kept.length > 0 ? JSON.stringify([page, ...kept]) : page
        );
    } catch {
        // Session storage refused: the registry records remain.
    }
}

/** A plain page id, or a page and the older ones it keeps (`keepPages`). */
function pageList(value: string): string[] {
    try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) {
            return parsed.filter(
                (page): page is string => typeof page === 'string'
            );
        }
    } catch {
        // A plain page id.
    }
    return [value];
}
