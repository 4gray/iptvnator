import { chromium } from '@playwright/test';
import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addXtreamPortal,
    interceptXtreamRequests,
} from './xtream-series-playback.fixture';

test('@xtream @pwa standalone series details stop vertical overscroll', async ({
    browserName,
    baseURL,
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
        await addXtreamPortal(page);
        await page.getByRole('link', { name: 'Series', exact: true }).click();
        await page.locator('app-grid-list mat-card').first().click();
        const shell = page.locator('app-portal-detail-shell');
        await expect(shell.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(shell).toHaveCSS('overscroll-behavior-y', 'none');
    } finally {
        await context.close();
    }
});
