import { join } from 'node:path';
import { expect, test } from './fixtures';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
} from './xtream-series-playback.fixture';
import {
    addCollisionFavorite,
    collisionItems,
    interceptCollidingXtreamItems,
} from './xtream-collection-helpers';
import {
    applyUiTheme,
    expectCollectionFits,
    rasterTextContrast,
    selectUiLanguage,
} from './ui-consistency.fixture';

test.beforeEach(async ({ page }) => {
    await page.route('https://**', (route) => route.abort());
    await interceptXtreamRequests(page);
    await page.goto('/');
});

test('@ui @xtream selected channel text stays readable on actual theme gradients', async ({
    page,
}, testInfo) => {
    await addXtreamPortal(page, { username: 'epg', password: 'epg' });
    await page.getByRole('link', { name: 'Live TV', exact: true }).click();
    await page
        .locator('.context-panel .category-item')
        .filter({ hasText: 'EPG Focus' })
        .click();
    await page.route(`${MOCK_SERVER}/live/**`, (route) =>
        route.fulfill({ status: 503, body: 'Fictional unavailable stream' })
    );
    const channel = page.locator('app-channel-list-item').first();
    await channel.locator('.channel-content').click();
    const selected = page.locator('.channel-list-item.active').first();
    await expect(selected.locator('.epg-title')).toBeVisible();
    for (const dark of [false, true]) {
        await applyUiTheme(page, dark);
        for (const hover of [false, true]) {
            if (hover) await selected.hover();
            else await page.mouse.move(0, 0);
            for (const selector of [
                '.channel-name',
                '.epg-title',
                '.epg-time',
            ]) {
                const text = selected.locator(selector).first();
                await expect
                    .poll(() => rasterTextContrast(text), {
                        message: `${dark ? 'dark' : 'light'} ${selector} selected hover=${hover}`,
                    })
                    .toBeGreaterThanOrEqual(4.5);
            }
        }
        await page.screenshot({
            path: testInfo.outputPath(`channel-${dark ? 'dark' : 'light'}.png`),
        });
    }
});

test('@ui @m3u navigation uses one font role across native group and provider buttons', async ({
    page,
}) => {
    await page.route(
        /^https?:\/\/(?:channel\.icons\.url|example\.channels|xml-url)\//,
        (route) => route.abort()
    );
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await dialog.getByRole('radio', { name: /M3U file/i }).click();
    await page.setInputFiles(
        'input[type=file]',
        join(__dirname, 'fixtures/test.m3u')
    );
    await dialog
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    await page.waitForURL(/\/all$/);
    await page.getByRole('link', { name: 'Groups', exact: true }).click();
    const m3u = page.locator('.group-nav-item:not(.selected)').first();
    await expect(m3u).toBeVisible();
    const family = await page
        .locator('body')
        .evaluate((el) => getComputedStyle(el).fontFamily);
    await expect(m3u).toHaveCSS('font-family', family);
    await expect(m3u).toHaveCSS('font-size', '14px');
    await expect(m3u).toHaveCSS('font-weight', '500');
    await addXtreamPortal(page, { username: 'minimal', password: 'minimal' });
    const provider = page.locator('.category-item:not(.selected)').first();
    await expect(provider).toHaveCSS('font-family', family);
    await expect(provider).toHaveCSS('font-size', '14px');
    await expect(provider).toHaveCSS('font-weight', '500');
});

test('@ui @collections all content filters and actions fit localized narrow panes', async ({
    page,
    request,
}, testInfo) => {
    test.setTimeout(120_000);
    const categories = await interceptCollidingXtreamItems(
        page,
        request,
        MOCK_SERVER
    );
    await addXtreamPortal(page, { username: 'minimal', password: 'minimal' });
    for (const item of collisionItems)
        await addCollisionFavorite(page, item, categories[item.type]);
    const playlistPath = new URL(page.url()).pathname.replace(
        /\/(live|series|vod).*$/,
        ''
    );
    for (const locale of ['en', 'de', 'ru'] as const) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await selectUiLanguage(page, locale);
        await page.goto(`${playlistPath}/favorites?scope=all&contentType=live`);
        const header = page.locator('.collection-header');
        await expect(
            header.locator('.content-toggle mat-button-toggle')
        ).toHaveCount(3);
        await header
            .locator('.content-toggle mat-button-toggle[value="live"]')
            .click();
        await expect(page.locator('app-unified-live-tab')).toBeVisible();
        for (const dark of [false, true]) {
            await applyUiTheme(page, dark);
            for (const width of [1440, 900, 620, 390]) {
                await page.setViewportSize({ width, height: 1000 });
                await expectCollectionFits(page);
                if (width <= 640) {
                    const tab = page.locator('app-unified-live-tab');
                    await expect(tab).toHaveCSS('flex-direction', 'column');
                    const rail = await tab.locator('.sidebar').boundingBox();
                    const player = await tab
                        .locator('.content-container')
                        .boundingBox();
                    expect(rail).not.toBeNull();
                    expect(player).not.toBeNull();
                    expect(player!.y).toBeGreaterThanOrEqual(
                        rail!.y + rail!.height - 1
                    );
                }
                await page.screenshot({
                    path: testInfo.outputPath(
                        `collection-${locale}-${dark ? 'dark' : 'light'}-${width}.png`
                    ),
                });
            }
        }
    }
});

test('@ui @xtream PWA selected movie and series categories retain their pane titles', async ({
    page,
    request,
}) => {
    await addXtreamPortal(page, { username: 'minimal', password: 'minimal' });
    for (const label of ['Movies', 'Series']) {
        const action =
            label === 'Movies' ? 'get_vod_categories' : 'get_series_categories';
        const response = await request.get(
            `${MOCK_SERVER}/player_api.php?username=minimal&password=minimal&action=${action}`
        );
        const [rawCategory] = (await response.json()) as Array<{
            category_id: string;
            category_name: string;
        }>;
        await page.getByRole('link', { name: label, exact: true }).click();
        const category = page.locator(
            `.context-panel .category-item[data-category-id="${rawCategory.category_id}"]`
        );
        const name = rawCategory.category_name;
        await expect(category.locator('.nav-item-label')).toHaveText(name);
        await category.click();
        await expect(
            page.locator('.category-content-header .category-title')
        ).toHaveText(name);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(
            page.locator('.category-content-header .category-title')
        ).toHaveText(name);
        await page.setViewportSize({ width: 1440, height: 1000 });
    }
});
