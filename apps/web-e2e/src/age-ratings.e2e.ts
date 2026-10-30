import { configureMockProviderBackend } from './provider-target-route';
import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER as XTREAM_SERVER,
} from './xtream-series-playback.fixture';
import {
    addStalkerPortal,
    interceptStalkerRequests,
    MOCK_SERVER as STALKER_SERVER,
    DEFAULT_MAC,
    EMBEDDED_SERIES_MAC,
} from './stalker-portal.fixture';
import {
    ageRating,
    interceptAgeRatingTmdb,
    setAgeRatingCountry,
    setAgeRatingTheme,
} from './age-ratings.fixture';

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
    await configureMockProviderBackend(page);
});

test('@web @metadata age-rating country saves independently of TMDB', async ({
    page,
}) => {
    await setAgeRatingCountry(page, 'DE');
    await page.reload();
    await expect(
        page.locator('[data-test-id="age-rating-country"]')
    ).toContainText('Germany');
    await expect(
        page.locator('[data-test-id="tmdb-enabled"] [role="switch"]')
    ).not.toBeChecked();
    await expect(page.locator('[data-test-id="tmdb-api-key"]')).toHaveCount(0);
});

for (const type of ['vod', 'series'] as const) {
    test(`@web @metadata Xtream ${type} shows age classifications and region fallback`, async ({
        page,
        request,
    }) => {
        test.setTimeout(90_000);
        await request.post(`${XTREAM_SERVER}/reset`);
        const tmdb = await interceptAgeRatingTmdb(page);
        await setAgeRatingCountry(page, 'DE', true);
        await interceptXtreamRequests(page);
        await page.goto('/');
        await addXtreamPortal(page);
        if (type === 'series')
            await page.goto(page.url().replace(/\/vod.*$/, '/series'));
        await expect(page.locator('.category-item').nth(1)).toBeVisible();
        await page.locator('.category-item').nth(1).click();
        await page.locator('app-grid-list mat-card').first().click();
        await expect(page.locator('app-content-hero')).toContainText(
            'A fictional metadata fixture'
        );
        await expect(ageRating(page)).toHaveText(
            type === 'vod' ? '12 · DE' : '16 · DE'
        );
        const detailUrl = page.url();
        const before = tmdb.requests();
        expect(tmdb.mediaTypes).toContain(type === 'vod' ? 'movie' : 'tv');
        await setAgeRatingCountry(page, 'FR');
        await page.locator('[data-test-id="workspace-header-back"]').click();
        await expect(page).toHaveURL(detailUrl);
        await expect(ageRating(page)).toHaveText(
            type === 'vod' ? 'PG-13 · US' : 'TV-14 · US'
        );
        expect(tmdb.requests()).toBe(before);
        const button = ageRating(page).getByRole('button');
        await button.focus();
        await expect(button).toHaveAttribute(
            'aria-label',
            /No classification for France/
        );
        await button.press('Enter');
        await expect(page.locator('.mat-mdc-tooltip-show')).toContainText(
            'Source: TMDB'
        );
        await button.press('Enter');
        await expect(page.locator('.mat-mdc-tooltip-show')).toBeHidden();
        if (type === 'vod') {
            for (const theme of ['Light', 'Dark'] as const) {
                await setAgeRatingTheme(page, theme, detailUrl);
                await expect(ageRating(page)).toHaveText('PG-13 · US');
                await page.locator('app-portal-detail-shell').screenshot({
                    animations: 'disabled',
                    path: test
                        .info()
                        .outputPath(`age-rating-${theme.toLowerCase()}.png`),
                });
            }
            await page.setViewportSize({ width: 700, height: 800 });
            await expect(ageRating(page)).toBeVisible();
            await page.screenshot({
                animations: 'disabled',
                path: test.info().outputPath('age-rating-narrow.png'),
            });
        }
    });
}

test('@web @metadata provider age rating is available without TMDB opt-in', async ({
    page,
    request,
}) => {
    await request.post(`${XTREAM_SERVER}/reset`);
    const tmdb = await interceptAgeRatingTmdb(page);
    await setAgeRatingCountry(page, 'DE');
    await interceptXtreamRequests(page);
    await page.goto('/');
    await addXtreamPortal(page);
    await page.locator('.category-item').nth(1).click();
    await page.locator('app-grid-list mat-card').first().click();
    await expect(ageRating(page)).toHaveText('PG-13 · US');
    await expect(ageRating(page).getByRole('button')).toHaveAttribute(
        'aria-label',
        /Source: Provider/
    );
    expect(tmdb.requests()).toBe(0);
});

for (const type of ['vod', 'series', 'embedded'] as const) {
    test(`@web @metadata Stalker ${type} selects the correct age-classification media type`, async ({
        page,
        request,
    }) => {
        test.setTimeout(90_000);
        const mac = type === 'embedded' ? EMBEDDED_SERIES_MAC : DEFAULT_MAC;
        await request.post(
            `${STALKER_SERVER}/reset?macAddress=${encodeURIComponent(mac)}`
        );
        const tmdb = await interceptAgeRatingTmdb(page);
        await setAgeRatingCountry(page, 'DE', true);
        await interceptStalkerRequests(page);
        await page.goto('/');
        await addStalkerPortal(page, { mac });
        if (type === 'series')
            await page.goto(page.url().replace(/\/vod.*$/, '/series'));
        await expect(page.locator('.category-item').nth(1)).toBeVisible();
        await page.locator('.category-item').nth(1).click();
        const cards = page.locator('app-grid-list mat-card');
        await expect(cards.first()).toBeVisible();
        const response = await request.get(
            `${STALKER_SERVER}/stalker?action=get_ordered_list&type=${type === 'series' ? 'series' : 'vod'}&category=${type === 'series' ? '3001' : '2001'}&p=1&macAddress=${mac}&JsHttpRequest=1-xml`
        );
        const body = await response.json();
        const rows: { name: string; year: string; series?: unknown[] }[] =
            body.payload.js.data;
        const selected =
            type === 'embedded'
                ? rows.find((item) => item.series?.length)
                : rows[0];
        expect(selected).toBeDefined();
        tmdb.setYear(selected!.year);
        await cards.filter({ hasText: selected!.name }).first().click();
        await expect(ageRating(page)).toHaveText(
            type === 'vod' ? '12 · DE' : '16 · DE'
        );
        expect(tmdb.mediaTypes).toContain(type === 'vod' ? 'movie' : 'tv');
        expect(tmdb.mediaTypes).not.toContain(type === 'vod' ? 'tv' : 'movie');
    });
}
