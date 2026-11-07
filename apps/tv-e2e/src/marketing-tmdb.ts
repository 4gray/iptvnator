import { expect, type Page } from '@playwright/test';
import { nav, xtream } from './helpers';

/** Exercise the real metadata client against the local fictional API and artwork. */
export async function enableMarketingTmdb(page: Page): Promise<void> {
    for (const origin of [
        'https://api.themoviedb.org/3/**',
        'https://image.tmdb.org/**',
    ]) {
        await page.route(origin, async (route) => {
            const url = new URL(route.request().url());
            const response = await route.fetch({
                url: `${xtream}/tmdb${url.pathname}${url.search}`,
            });
            await route.fulfill({ response });
        });
    }
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Metadata · TMDB', exact: false })
        .click();
    await page.getByLabel('Use TMDB metadata').check();
    await page
        .getByLabel('TMDB API key or read access token')
        .fill('synthetic-demo-key');
    await page.getByRole('button', { name: 'Save TMDB settings' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'saved'
    );
}
