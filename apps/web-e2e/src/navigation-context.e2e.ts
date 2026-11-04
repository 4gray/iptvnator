import type { Page } from '@playwright/test';
import { navigationPortalResponse } from '@iptvnator/shared/testing';
import { test, expect } from './fixtures';
import { addXtreamPortal } from './xtream-series-playback.fixture';
import {
    configureMockProviderBackend,
    interceptProviderTargetRegistration,
} from './provider-target-route';

test.use({ serviceWorkers: 'block' });

async function installPortal(page: Page): Promise<void> {
    await configureMockProviderBackend(page);
    await interceptProviderTargetRegistration(page);
    await page.route('**/localhost:3000/xtream**', (route) =>
        route.fulfill({
            json: {
                payload: navigationPortalResponse(
                    new URL(route.request().url()).searchParams
                ),
            },
        })
    );
}

const back = (page: Page) =>
    page.locator('[data-test-id="workspace-header-back"]');

test.beforeEach(async ({ page }) => {
    await installPortal(page);
    await page.goto('/');
    await addXtreamPortal(page, {
        name: 'Synthetic Source A',
        username: 'synthetic-a',
        password: 'synthetic-only',
    });
    await expect(page.locator('app-grid-list mat-card').first()).toBeVisible();
});

for (const kind of ['vod', 'series'] as const) {
    test(`@web @xtream cold ${kind} detail Back replaces the entry with its owning category`, async ({
        page,
    }) => {
        const root = page.url().replace(/\/vod.*$/, '');
        const path = kind === 'vod' ? 'vod/201/20001' : 'series/301/30001';
        const title =
            kind === 'vod' ? 'Synthetic Film A1' : 'Synthetic Series A1';
        const cold = await page.context().newPage();
        await installPortal(cold);
        await cold.goto(`${root}/${path}?q=Synthetic`);
        await expect(cold.locator('app-portal-detail-shell h1')).toHaveText(
            title
        );
        const index = await cold.evaluate(() => navigation.currentEntry?.index);
        await back(cold).click();
        await expect(cold).toHaveURL(
            `${root}/${kind}/${kind === 'vod' ? '201' : '301'}?q=Synthetic`
        );
        await expect(
            cold.locator('app-grid-list mat-card').first()
        ).toBeVisible();
        expect(await cold.evaluate(() => navigation.currentEntry?.index)).toBe(
            index
        );
        await expect(back(cold)).toHaveCount(0);
        await cold.close();
    });
}

test('@web @xtream searched foreign favorites retain their tab and All playlists on Back and Forward', async ({
    page,
}) => {
    await page.getByRole('link', { name: 'Sources', exact: true }).click();
    await expect(page.locator('app-source-row')).toHaveCount(1);
    await addXtreamPortal(page, {
        name: 'Synthetic Source B',
        username: 'synthetic-b',
        password: 'synthetic-only',
    });
    await expect(page.locator('app-grid-list mat-card').first()).toBeVisible();
    await page.locator('app-grid-list mat-card').first().click();
    await page
        .getByRole('button', { name: 'Add to favorites', exact: true })
        .click();
    await page.getByRole('link', { name: 'Sources', exact: true }).click();
    await page
        .locator('app-source-row')
        .filter({ hasText: 'Synthetic Source A' })
        .locator('.source-row__body')
        .click();
    await expect(page.locator('app-grid-list mat-card').first()).toBeVisible();
    await page
        .getByRole('link', { name: 'Global favorites', exact: true })
        .click();
    const all = page.getByRole('radio', { name: /All playlists/ });
    await expect(all).toBeVisible();
    await all.click();
    const search = page.locator(
        'app-workspace-shell-header input[type="search"]'
    );
    await search.fill('Synthetic Film B');
    await expect(page).toHaveURL(/q=Synthetic%20Film%20B/);
    const card = page.locator('app-content-card');
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page.locator('app-portal-detail-shell h1')).toHaveText(
        'Synthetic Film B1'
    );
    await back(page).click();
    await expect(all).toHaveAttribute('aria-checked', 'true');
    await expect(card).toContainText('Synthetic Film B1');
    expect(
        await page.evaluate(() => history.state.collectionViewState)
    ).toEqual({ selectedContentType: 'movie', scope: 'all' });
    await page.goForward();
    await expect(page.locator('app-portal-detail-shell h1')).toHaveText(
        'Synthetic Film B1'
    );
    await page.goBack();
    await expect(all).toHaveAttribute('aria-checked', 'true');
    await search.fill('');
    await expect(page).not.toHaveURL(/\?q=/);
    await page.reload();
    await expect(all).toHaveAttribute('aria-checked', 'true');
    await expect(card).toContainText('Synthetic Film B1');
});
