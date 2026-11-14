import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
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
