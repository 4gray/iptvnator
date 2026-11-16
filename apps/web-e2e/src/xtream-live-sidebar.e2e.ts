import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import { expectNoOverlap } from './ui-consistency.fixture';
import {
    addXtreamPortal,
    DEFAULT_PASSWORD,
    DEFAULT_USERNAME,
    interceptXtreamRequests,
    MOCK_SERVER,
} from './xtream-series-playback.fixture';

test.use({ serviceWorkers: 'block' });

test('@xtream folded live categories keep keyboard focus when returning to All Items', async ({
    page,
    request,
}) => {
    await request.post(
        `${MOCK_SERVER}/reset?username=${DEFAULT_USERNAME}&password=${DEFAULT_PASSWORD}`
    );
    await configureMockProviderBackend(page);
    await page.goto('/');
    await interceptXtreamRequests(page);
    await addXtreamPortal(page);
    await page.goto(page.url().replace(/\/vod.*$/, '/live'));

    await page.locator('.context-panel .category-item').first().click();
    await page
        .getByRole('button', { name: 'Hide categories', exact: true })
        .click();
    await page.getByRole('button', { name: 'Choose category' }).press('Enter');
    await page
        .getByRole('dialog')
        .locator('.category-item--selected')
        .press('Enter');

    await expect(
        page.getByRole('button', { name: 'Show categories', exact: true })
    ).toBeFocused();
    await expect(page.locator('.live-all-items-content')).toBeVisible();
});

// The floating handle that brings the folded panels back sits over the All
// Items header's leading edge; the header has to make room for it.
test('@ui @xtream All Items title clears the floating panel handles', async ({
    page,
}) => {
    test.setTimeout(90_000);
    await page.route('https://**', (route) => route.abort());
    await interceptXtreamRequests(page);
    await page.goto('/');
    await addXtreamPortal(page, { name: 'Live Handles Portal' });
    const live = page.url().replace(/\/vod.*$/, '/live');
    await page.goto(live);
    await page.locator('.context-panel .category-item').first().click();

    const title = page.locator('.live-all-items-content .category-title');
    const levels = [
        {
            name: 'categories hidden',
            control: 'Hide categories',
            handle: page.locator('[data-test-id="live-show-categories"]'),
        },
        {
            name: 'panels collapsed',
            control: 'Hide categories and channels',
            handle: page.locator('.content-container > .sidebar-restore'),
        },
    ];
    for (const level of levels) {
        await page
            .getByRole('button', { name: level.control, exact: true })
            .click();
        // Back to the landing grid with the level kept (it is persisted).
        await page.goto(live);
        await expect(title).toBeVisible();
        await expect(level.handle).toBeVisible();
        await page.mouse.move(700, 600);
        for (const width of [860, 1100, 1400]) {
            await page.setViewportSize({ width, height: 900 });
            const label = `${level.name} at ${width}px`;
            await expect(level.handle, label).toBeVisible();
            await expectNoOverlap([title, level.handle], label);
            await expectNoOverlap(
                [title, level.handle.locator('mat-icon')],
                `${label} (icon)`
            );
        }
        await page.screenshot({
            path: test.info().outputPath(`${level.name}.png`),
        });
        // Restore the expanded level for the next pass.
        await page.evaluate(() =>
            localStorage.removeItem('live-sidebar-state:portal')
        );
        await page.goto(live);
        await page.locator('.context-panel .category-item').first().click();
    }
});
