import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { setSwitch } from './e2e-helpers';
import {
    addStalkerPortal,
    interceptStalkerRequests,
} from './stalker-portal.fixture';
import {
    addXtreamPortal,
    interceptXtreamRequests,
} from './xtream-series-playback.fixture';

const guideActions = new Set([
    'get_short_epg',
    'get_epg_info',
    'get_simple_data_table',
    'get_simple_date_table',
]);

async function setEpg(page: Page, enabled: boolean): Promise<void> {
    await page.getByRole('link', { name: 'Open settings' }).click();
    await page.locator('[data-test-id="settings-section-epg"]').click();
    const toggle = page
        .locator('[data-test-id="toggle-epg-enabled"]')
        .getByRole('switch');
    await expect(toggle).toBeVisible();
    await setSwitch(toggle, enabled);
    const save = page.locator('[data-test-id="save-settings"]');
    await save.click();
    await expect(save).toBeHidden();
}

test.use({ serviceWorkers: 'block' });

for (const provider of ['xtream', 'stalker'] as const) {
    test(`@epg @settings @web @${provider} global opt-out preserves logos and stops guides across reload`, async ({
        page,
    }) => {
        const requests: string[] = [];
        page.on('request', (request) => {
            const action = new URL(request.url()).searchParams.get('action');
            if (action && guideActions.has(action)) requests.push(action);
        });
        // Keep provider logos deterministic, independently of their external hosts.
        await page.route('**/*', async (route) => {
            if (route.request().resourceType() === 'image') {
                await route.fulfill({
                    contentType: 'image/svg+xml',
                    body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="navy"/></svg>',
                });
            } else await route.fallback();
        });
        if (provider === 'xtream') await interceptXtreamRequests(page);
        else await interceptStalkerRequests(page);

        await page.goto('/');
        await setEpg(page, false);
        await expect(
            page.locator('[data-test-id="epg-disabled-hint"]')
        ).toBeVisible();
        await page.reload();
        await expect(
            page
                .locator('[data-test-id="toggle-epg-enabled"]')
                .getByRole('switch')
        ).not.toBeChecked();
        await page.goto('/workspace/dashboard');

        if (provider === 'xtream')
            await addXtreamPortal(page, {
                name: 'EPG toggle',
                username: 'epg',
                password: 'epg',
            });
        else
            await addStalkerPortal(page, {
                name: 'EPG toggle',
                mac: '00:1A:79:6E:00:01',
            });
        await page.getByRole('link', { name: /live tv/i }).click();
        const category =
            provider === 'xtream'
                ? page
                      .locator('.category-item')
                      .filter({ hasText: 'EPG Focus' })
                : page.locator('.category-item').nth(1);
        await category.click();
        const channel = page.locator('[data-test-id="channel-item"]').first();
        await expect(channel).toBeVisible();
        await expect(channel).toHaveClass(/compact/);
        await expect(channel.locator('.channel-logo')).toBeVisible();
        const logo = await channel.locator('.channel-logo').getAttribute('src');
        if (!logo) throw new Error('Provider logo is missing');
        await expect(
            channel.locator(
                '.epg-title, .epg-timeline, .epg-placeholder, .program-info-button'
            )
        ).toHaveCount(0);
        await channel.click();
        await expect(page.locator('app-web-player-view')).toBeVisible();
        await expect(
            page.locator('app-epg-timeline, app-epg-list-view')
        ).toHaveCount(0);
        const liveUrl = page.url();
        await page.reload();
        await category.click();
        await expect(channel).toHaveClass(/compact/);
        await expect(channel.locator('.channel-logo')).toHaveAttribute(
            'src',
            logo!
        );
        expect(requests).toEqual([]);

        await setEpg(page, true);
        await page.goto(liveUrl);
        await category.click();
        await expect(channel).not.toHaveClass(/compact/);
        await expect.poll(() => requests.length).toBeGreaterThan(0);
        await expect(channel.locator('.channel-logo')).toHaveAttribute(
            'src',
            logo!
        );
    });
}
