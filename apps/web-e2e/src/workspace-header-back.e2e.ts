import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
} from './xtream-series-playback.fixture';

/**
 * Pages reached from a detail or the header search draw no Back arrow of
 * their own: they register the workspace header's leading Back. It goes back
 * in history when the page was reached in the app; a page that opened the
 * session (a deep link, reload or restored view) leads to its parent
 * instead, replacing its own history entry.
 * Contract: docs/architecture/workspace-shell.md, "Header Back".
 */

const headerBack = (page: Page) =>
    page.locator(
        'app-workspace-shell-header [data-test-id="workspace-header-back"]'
    );

/** The one Back button on the page, wherever it lives. */
const anyBack = (page: Page) =>
    page.getByRole('button', { name: 'Back', exact: true });

async function expectOnlyHeaderBack(page: Page): Promise<void> {
    await expect(headerBack(page)).toBeVisible();
    await expect(anyBack(page)).toHaveCount(1);
    // None of these pages handles Escape.
    await expect(headerBack(page)).not.toHaveAttribute('aria-keyshortcuts');
}

/** The portal's own URL, from the VOD list that adding it opens. */
function portalUrlOf(page: Page): string {
    return page.url().replace(/\/vod.*$/, '');
}

/**
 * Opens `url` as the only entry of a new tab's history, where browser Back
 * has nowhere to go, as in Electron after a deep link or restored view. A
 * `page.goto` in the same tab would leave the previous document behind,
 * often at the very URL of the parent.
 */
async function openAsFirstEntry(page: Page, url: string): Promise<Page> {
    const firstEntryPage = await page.context().newPage();
    await interceptXtreamRequests(firstEntryPage);
    await firstEntryPage.goto(url);
    return firstEntryPage;
}

test.beforeEach(async ({ page, request }) => {
    await request.post(`${MOCK_SERVER}/reset`);
    await page.goto('/');
    await interceptXtreamRequests(page);
    await addXtreamPortal(page);
});

test('@web @xtream the in-portal search page reached in the app goes back in history', async ({
    page,
}) => {
    await page
        .locator('app-workspace-shell-rail a[href$="/workspace/dashboard"]')
        .first()
        .click();
    await page.waitForURL(/\/workspace\/dashboard$/);
    // The rail link's tooltip would otherwise sit over the header's leading
    // button for as long as the pointer rests on the link.
    await page.mouse.move(640, 400);

    // Enter on the dashboard opens the active portal's search page.
    const search = page.locator(
        'app-workspace-shell-header .search-field input[type="search"]'
    );
    await search.fill('Movie');
    await search.press('Enter');
    await page.waitForURL(/\/workspace\/xtreams\/[^/]+\/search\?q=Movie$/);
    await expect(page.locator('app-search-layout')).toBeVisible();

    await expectOnlyHeaderBack(page);
    await headerBack(page).click();
    await page.waitForURL(/\/workspace\/dashboard$/);
});

for (const { name, path, selector, parent } of [
    {
        name: 'movie Discover',
        path: 'discover?type=movie&genre=18&genreLabel=Drama',
        selector: 'app-discover-view',
        parent: 'vod',
    },
    {
        name: 'series Discover',
        path: 'discover?type=tv&genre=18&genreLabel=Drama',
        selector: 'app-discover-view',
        parent: 'series',
    },
    // The portal root: its route config redirects to the default section.
    {
        name: 'actor',
        path: 'actor/287',
        selector: 'app-actor-view',
        parent: 'vod',
    },
    {
        name: 'search',
        path: 'search?q=Movie',
        selector: 'app-search-layout',
        parent: 'vod',
    },
]) {
    test(`@web @xtream the ${name} page opening the session leads to its parent`, async ({
        page,
    }) => {
        const portalUrl = portalUrlOf(page);
        const firstEntryPage = await openAsFirstEntry(
            page,
            `${portalUrl}/${path}`
        );
        // A cold start in a new tab passes the startup splash first.
        await expect(firstEntryPage.locator(selector)).toBeAttached({
            timeout: 15_000,
        });

        await expectOnlyHeaderBack(firstEntryPage);
        await headerBack(firstEntryPage).click();
        await firstEntryPage.waitForURL(`${portalUrl}/${parent}`);
        // The parent replaced the page's entry, so nothing precedes it and
        // the list shows no Back (the history fallback would otherwise).
        await expect(headerBack(firstEntryPage)).toHaveCount(0);
    });
}
