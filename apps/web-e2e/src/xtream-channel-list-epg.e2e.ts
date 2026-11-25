import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    interceptXtreamRequests,
} from './xtream-series-playback.fixture';

/**
 * The live channel list asks for the current programme of the rows on
 * screen. Two categories of the mock portal render the same index range, so
 * the virtual scroll viewport emits no new range when the second one opens;
 * its rows must still get their programme well before the one-minute
 * refresh tick.
 */
test('@xtream @epg a second live category with the same visible range loads its programmes', async ({
    page,
}) => {
    await page.route('https://**', (route) => route.abort());
    await interceptXtreamRequests(page);
    await page.goto('/');
    await addXtreamPortal(page, { name: 'Channel List EPG Portal' });
    await page.goto(page.url().replace(/\/vod.*$/, '/live'));

    const categories = page.locator('.context-panel .category-item');
    const rows = page.locator(
        'app-live-stream-layout [data-test-id="channel-item"]'
    );

    await categories.nth(1).click();
    await expect(rows.first().locator('.epg-title')).toBeVisible({
        timeout: 15_000,
    });
    const firstCategoryRows = await rows.count();
    const firstCategoryTitle = await rows.first().textContent();

    await categories.nth(2).click();
    await expect(rows.first()).not.toHaveText(firstCategoryTitle ?? '');
    // Same rendered index range as the first category: the case the
    // viewport's range stream does not report.
    await expect(rows).toHaveCount(firstCategoryRows);
    await expect(rows.first().locator('.epg-title')).toBeVisible({
        timeout: 10_000,
    });
    await expect(rows.locator('.epg-title')).toHaveCount(firstCategoryRows);
});
