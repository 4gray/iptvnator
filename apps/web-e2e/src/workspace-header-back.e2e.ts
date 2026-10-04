import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
} from './xtream-series-playback.fixture';

/**
 * Pages reached from a detail or the header search draw no Back arrow of
 * their own: they register the workspace header's leading Back, which keeps
 * their previous return behaviour (history Back).
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

test.beforeEach(async ({ page, request }) => {
    await request.post(`${MOCK_SERVER}/reset`);
    await page.goto('/');
    await interceptXtreamRequests(page);
    await addXtreamPortal(page);
});

test('@web @xtream the in-portal search page returns through the header Back', async ({
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

for (const { name, path, selector } of [
    {
        name: 'Discover',
        path: 'discover?type=movie&genre=18&genreLabel=Drama',
        selector: 'app-discover-view',
    },
    { name: 'actor', path: 'actor/287', selector: 'app-actor-view' },
]) {
    test(`@web @xtream the ${name} page returns through the header Back`, async ({
        page,
    }) => {
        const listUrl = page.url();
        const portalUrl = listUrl.replace(/\/vod.*$/, '');

        await page.goto(`${portalUrl}/${path}`);
        await expect(page.locator(selector)).toBeAttached();

        await expectOnlyHeaderBack(page);
        await headerBack(page).click();
        await page.waitForURL(listUrl);
    });
}
