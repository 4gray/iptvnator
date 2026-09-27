import type { Page } from '@playwright/test';

export interface SidebarCategorySnapshot {
    id: string;
    itemCount: number;
    name: string;
}

const VISIBLE_SIDEBAR_CATEGORIES =
    'app-workspace-context-panel .category-item:visible';

/**
 * Reads the visible sidebar categories in one DOM snapshot.
 *
 * Do not loop over `count()` with per-row `nth(index)` reads here: those
 * locator calls auto-wait, so a row the sidebar removes between the count and
 * the read (for example right after hiding categories) blocks the call until
 * the surrounding `expect.poll` times out instead of letting the poll retry.
 */
export async function readVisibleSidebarCategories(
    page: Page
): Promise<SidebarCategorySnapshot[]> {
    return page.locator(VISIBLE_SIDEBAR_CATEGORIES).evaluateAll((rows) =>
        rows.map((row) => ({
            id: row.getAttribute('data-category-id')?.trim() ?? '',
            itemCount:
                Number.parseInt(
                    row.querySelector('.item-count')?.textContent?.trim() ?? '',
                    10
                ) || 0,
            name:
                row.querySelector('.nav-item-label')?.textContent?.trim() ?? '',
        }))
    );
}

export async function readVisibleSidebarCategoryNames(
    page: Page
): Promise<string[]> {
    return (await readVisibleSidebarCategories(page))
        .map((category) => category.name)
        .filter(Boolean);
}
