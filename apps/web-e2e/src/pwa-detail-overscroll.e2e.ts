import { chromium } from '@playwright/test';
import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addXtreamPortal,
    DEFAULT_PASSWORD,
    DEFAULT_USERNAME,
    interceptXtreamRequests,
    MOCK_SERVER,
} from './xtream-series-playback.fixture';

test('@xtream @pwa standalone workspace and series details stop vertical overscroll', async ({
    browserName,
    baseURL,
    request,
}) => {
    test.skip(browserName !== 'chromium', 'Requires Chromium app mode');
    const context = await chromium.launchPersistentContext('', {
        baseURL,
        channel: 'chromium',
        args: [`--app=${baseURL}`],
        serviceWorkers: 'block',
    });
    try {
        const [page] = context.pages();
        await configureMockProviderBackend(page);
        await interceptXtreamRequests(page);
        await page.goto('/');
        await expect
            .poll(() =>
                page.evaluate(
                    () => matchMedia('(display-mode: standalone)').matches
                )
            )
            .toBe(true);
        await expect(page).toHaveURL(/\/workspace\/dashboard$/);
        await expect(page.locator('main.workspace-content')).toHaveCSS(
            'overscroll-behavior-y',
            'none'
        );
        await expect(page.locator('html')).toHaveCSS(
            'overscroll-behavior-y',
            'none'
        );
        await addXtreamPortal(page);
        await page.goto(page.url().replace(/\/vod.*$/, '/series'));
        await expect(page).toHaveURL(/\/series$/);
        const grid = page.locator('app-category-content-view app-grid-list');
        await expect(grid).toHaveCSS('overscroll-behavior-y', 'none');
        const response = await request.get(`${MOCK_SERVER}/player_api.php`, {
            params: {
                username: DEFAULT_USERNAME,
                password: DEFAULT_PASSWORD,
                action: 'get_series',
            },
        });
        const [series] = (await response.json()) as {
            category_id: string;
            series_id: number;
        }[];
        await page.goto(
            `${page.url()}/${series.category_id}/${series.series_id}`
        );
        const shell = page.locator('app-portal-detail-shell');
        await expect(shell.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(shell).toHaveCSS('overscroll-behavior-y', 'none');
    } finally {
        await context.close();
    }
});

test('@web browser dashboard keeps default overscroll', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/workspace\/dashboard$/);
    await expect(page.locator('main.workspace-content')).toHaveCSS(
        'overscroll-behavior-y',
        'auto'
    );
    await expect(page.locator('html')).toHaveCSS(
        'overscroll-behavior-y',
        'auto'
    );
});
