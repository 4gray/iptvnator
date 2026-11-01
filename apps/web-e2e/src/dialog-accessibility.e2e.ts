import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
    playFirstSeriesEpisode,
    rewriteSeriesEpisodesToMp4,
    routeEpisodeClip,
    selectWebPlayer,
} from './xtream-series-playback.fixture';
import { applyUiTheme, rasterTextContrast } from './ui-consistency.fixture';
import type { Locator } from '@playwright/test';
import { configureMockProviderBackend } from './provider-target-route';

test.use({ serviceWorkers: 'block' });

/** Hide only the label during sampling, retaining the pill's painted tint. */
async function chipTextContrast(pill: Locator): Promise<number> {
    await pill.evaluate((element) => {
        const label = document.createElement('span');
        label.append(...element.childNodes);
        element.append(label);
    });
    try {
        return await rasterTextContrast(pill.locator('span'));
    } finally {
        await pill.evaluate((element) => {
            const label = element.querySelector('span');
            label?.replaceWith(...label.childNodes);
        });
    }
}

test.beforeEach(async ({ page }) => {
    await page.route('https://**', (route) => route.abort());
    await configureMockProviderBackend(page);
    await interceptXtreamRequests(page);
    await page.goto('/');
});

test('account info keeps keyboard scrolling and aligned, readable status in small PWA windows', async ({
    page,
}, testInfo) => {
    test.setTimeout(120_000);
    await addXtreamPortal(page);
    for (const dark of [false, true]) {
        await applyUiTheme(page, dark);
        for (const viewport of [
            { width: 1024, height: 520 },
            { width: 390, height: 844 },
        ]) {
            await page.setViewportSize(viewport);
            await page.locator('body').focus();
            await page.keyboard.press(
                process.platform === 'darwin' ? 'Meta+k' : 'Control+k'
            );
            const palette = page.locator('app-workspace-command-palette');
            await palette.locator('input[type="search"]').fill('account');
            await palette
                .getByRole('button', { name: /Account info/i })
                .click();
            const dialog = page.getByRole('dialog');
            await expect(dialog.locator('.account-stat').first()).toBeVisible();
            const body = dialog.getByRole('region', {
                name: 'Account Information',
            });
            await expect(body).toBeFocused();
            const status = dialog.locator(
                '.account-dialog__status-pill--active'
            );
            await expect
                .poll(() => chipTextContrast(status))
                .toBeGreaterThanOrEqual(4.5);
            if (viewport.width > 640) {
                const centers = await dialog.evaluate((element) =>
                    [
                        '.app-dialog__icon',
                        '.app-dialog__close',
                        '.account-dialog__status-pill',
                    ].map((selector) => {
                        const rect = element
                            .querySelector(selector)!
                            .getBoundingClientRect();
                        return rect.top + rect.height / 2;
                    })
                );
                expect(
                    Math.max(...centers) - Math.min(...centers)
                ).toBeLessThanOrEqual(2);
            }
            await page.screenshot({
                path: testInfo.outputPath(
                    `account-${dark ? 'dark' : 'light'}-${viewport.width}x${viewport.height}.png`
                ),
            });
            await page.keyboard.press('PageDown');
            await expect
                .poll(() => body.evaluate((element) => element.scrollTop))
                .toBeGreaterThan(0);
            await expect(
                dialog.getByRole('button', { name: 'Close dialog' })
            ).toBeInViewport();
            for (const chip of await dialog.locator('.account-chip').all()) {
                await chip.scrollIntoViewIfNeeded();
                await expect
                    .poll(() => chipTextContrast(chip))
                    .toBeGreaterThanOrEqual(4.5);
            }
            await page.keyboard.press('Escape');
            await expect(dialog).toBeHidden();
        }
    }
});

test('a long programme remains keyboard-scrollable with reachable actions on a phone', async ({
    page,
}, testInfo) => {
    test.setTimeout(120_000);
    const description =
        'A long description of the fictional evening programme. '.repeat(45);
    // Enrich only the synthetic provider guide; no product state hooks.
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const original = new URL(route.request().url());
        const action = original.searchParams.get('action');
        if (
            ![
                'get_short_epg',
                'get_simple_data_table',
                'get_simple_date_table',
            ].includes(action ?? '')
        ) {
            await route.fallback();
            return;
        }
        const url = new URL(`${MOCK_SERVER}/player_api.php`);
        original.searchParams.forEach((value, key) => {
            if (key !== 'targetId') url.searchParams.set(key, value);
        });
        url.searchParams.set('username', 'epg');
        url.searchParams.set('password', 'epg');
        const response = await route.fetch({ url: url.toString() });
        const body = await response.json();
        for (const item of body.epg_listings ?? [])
            item.description = Buffer.from(description).toString('base64');
        await route.fulfill({ response, json: { payload: body, action } });
    });
    await addXtreamPortal(page, { username: 'epg', password: 'epg' });
    await page.getByRole('link', { name: 'Live TV', exact: true }).click();
    await page
        .locator('.context-panel .category-item')
        .filter({ hasText: 'EPG Focus' })
        .click();
    const channel = page
        .locator('app-live-stream-layout [data-test-id="channel-item"]')
        .filter({ hasText: 'Timezone News' });
    await expect(channel.locator('.epg-title')).toHaveText('Global Headlines', {
        timeout: 20_000,
    });
    await channel.click();
    const timeline = page.locator('app-live-stream-layout app-epg-timeline');
    const block = timeline.locator('.epg-timeline__block.is-now').first();
    await expect(block).toBeVisible();
    await timeline.locator('.epg-timeline__zoom').click();
    await block.locator('.epg-timeline__info').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.epg-dialog__desc')).toHaveText(
        description.trim()
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const body = dialog.getByRole('region', { name: 'Global Headlines' });
    await expect(body).toBeFocused();
    const start = await body.evaluate((element) => element.scrollTop);
    await page.keyboard.press('PageDown');
    await expect
        .poll(() => body.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(start);
    await page.keyboard.press('End');
    await expect(dialog.locator('.epg-dialog__close')).toBeInViewport({
        ratio: 1,
    });
    await expect(dialog.locator('.epg-dialog__btn--primary')).toBeInViewport({
        ratio: 1,
    });
    await page.screenshot({
        path: testInfo.outputPath('programme-phone-scrolled.png'),
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
});

test('focused account and shortcut regions keep playback keys away from a mounted player', async ({
    page,
    request,
}) => {
    test.setTimeout(120_000);
    await routeEpisodeClip(page);
    await rewriteSeriesEpisodesToMp4(page);
    await selectWebPlayer(page, 'HTML5 video player');
    const { video } = await playFirstSeriesEpisode(page, request);
    await expect
        .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.readyState)
        )
        .toBeGreaterThanOrEqual(2);
    await video.evaluate((element: HTMLVideoElement) => element.pause());
    const volume = await video.evaluate(
        (element: HTMLVideoElement) => element.volume
    );
    await page.setViewportSize({ width: 1024, height: 520 });

    for (const kind of ['account', 'shortcuts']) {
        await page.locator('body').focus();
        if (kind === 'account') {
            await page.keyboard.press(
                process.platform === 'darwin' ? 'Meta+k' : 'Control+k'
            );
            const palette = page.locator('app-workspace-command-palette');
            await palette.locator('input[type="search"]').fill('account');
            await palette
                .getByRole('button', { name: /Account info/i })
                .click();
        } else {
            await page.keyboard.press('?');
        }
        const dialog = page.getByRole('dialog');
        const region = dialog.getByRole('region');
        await expect(region).toBeFocused();
        for (const key of ['ArrowDown', ' ', 'k', 'm']) {
            await page.keyboard.press(key);
            await expect(video).toHaveJSProperty('volume', volume);
            await expect(video).toHaveJSProperty('paused', true);
        }
        await page.keyboard.press('PageDown');
        await expect
            .poll(() => region.evaluate((element) => element.scrollTop))
            .toBeGreaterThan(0);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
    }
});
