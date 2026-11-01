import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addStalkerPortal,
    interceptStalkerRequests,
} from './stalker-portal.fixture';
import { setSwitch } from './e2e-helpers';

const selectedPlot = 'Синтетическое описание выбранного сериала.';
const providerPlot = 'Синтетическое описание из портала.';
const selectedPoster = '/synthetic-alpha.svg';
const otherPoster = '/synthetic-beta.svg';
const title = 'Синтетический сериал Альфа (8 серий)';

test('@tmdb-match persists a manual series match, restores provider metadata and automatic matching', async ({
    page,
}) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await configureMockProviderBackend(page);
    await page.route('https://image.tmdb.org/**', (route) => {
        const alternate = route.request().url().includes('synthetic-beta');
        return route.fulfill({
            contentType: 'image/svg+xml',
            body:
                '<svg xmlns="http://www.w3.org/2000/svg" width="330" height="495" viewBox="0 0 330 495">' +
                '<rect width="330" height="495" fill="' +
                (alternate ? '#283f73' : '#315c4f') +
                '"/>' +
                '<circle cx="165" cy="220" r="105" fill="' +
                (alternate ? '#759ed1' : '#bed5a2') +
                '"/>' +
                '<text x="165" y="390" text-anchor="middle" fill="white" font-family="sans-serif" font-size="23">SYNTHETIC SERIES</text>' +
                '<text x="165" y="430" text-anchor="middle" fill="white" font-family="sans-serif" font-size="25">' +
                (alternate ? 'BETA' : 'ALPHA') +
                '</text></svg>',
        });
    });

    await page.route('**/localhost:3000/connectivity-guard/reset**', (route) =>
        route.fulfill({
            json: { success: true },
            headers: {
                'access-control-allow-origin': '*',
                'access-control-allow-headers': '*',
                'access-control-allow-methods': 'POST, OPTIONS',
            },
        })
    );
    await interceptStalkerRequests(page);
    let searchFails = false;
    await page.route('https://api.themoviedb.org/**', (route) => {
        const url = new URL(route.request().url());
        const base = {
            name: 'Синтетический сериал Альфа',
            first_air_date: '2026-02-03',
            poster_path: selectedPoster,
        };
        if (url.pathname.includes('/search/')) {
            if (searchFails)
                return route.fulfill({ status: 503, body: 'Unavailable' });
            return route.fulfill({
                json: {
                    results: [
                        {
                            ...base,
                            id: 900101,
                            original_name: 'Синтетический сериал Альфа',
                            original_language: 'ru',
                            origin_country: ['RU'],
                            overview: selectedPlot,
                            vote_count: 0,
                        },
                        {
                            ...base,
                            id: 900102,
                            original_name: 'Synthetic Series Beta',
                            original_language: 'en',
                            origin_country: ['US'],
                            first_air_date: '2026-09-10',
                            poster_path: otherPoster,
                            overview:
                                'Описание другого синтетического сериала.',
                            vote_count: 1000,
                        },
                    ],
                },
            });
        }
        if (url.pathname.includes('/season/'))
            return route.fulfill({
                json: {
                    season_number: 1,
                    episodes: [
                        {
                            episode_number: 1,
                            name: 'Синтетический эпизод Альфа',
                            overview: 'Синтетическое описание эпизода.',
                        },
                    ],
                },
            });
        return route.fulfill({
            json: {
                ...base,
                id: 900101,
                original_language: 'ru',
                overview: selectedPlot,
                backdrop_path: '/synthetic-backdrop.svg',
                content_ratings: { results: [] },
                created_by: [{ id: 900501, name: 'Synthetic Creator Alpha' }],
                credits: { cast: [], crew: [] },
            },
        });
    });
    await page.route('**/localhost:3000/stalker**', (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (
            params.get('action') !== 'get_ordered_list' ||
            params.get('type') !== 'vod'
        )
            return route.fallback();
        const rows = !params.get('movie_id')
            ? [
                  {
                      id: '99001',
                      name: title,
                      o_name: 'Синтетический сериал Альфа',
                      is_series: '1',
                      category_id: '2001',
                      year: '2026',
                      description: providerPlot,
                      screenshot_uri: `https://image.tmdb.org/t/p/w500${selectedPoster}`,
                  },
              ]
            : params.has('season_id')
              ? [
                    {
                        id: 'episode-99001',
                        is_episode: true,
                        series_number: 1,
                        name: 'Episode 1',
                    },
                ]
              : [
                    {
                        id: 'provider-season-1',
                        video_id: '99001',
                        name: 'Season 1',
                        season_number: '1',
                        is_season: true,
                    },
                ];
        return route.fulfill({
            json: {
                payload: {
                    js: {
                        data: rows,
                        total_items: rows.length,
                        max_page_items: 20,
                    },
                },
            },
        });
    });
    await page.goto('/workspace/settings/tmdb');
    await setSwitch(
        page.locator('[data-test-id="tmdb-enabled"] [role="switch"]'),
        true
    );
    await page.locator('[data-test-id="tmdb-api-key"]').fill('fixture-key');
    const saveSettings = page.getByRole('button', { name: 'Save changes' });
    await saveSettings.click();
    await expect(saveSettings).toBeHidden();
    await page.goto('/');
    await addStalkerPortal(page, {
        name: 'Synthetic Portal',
        mac: '00:1A:79:7C:00:01',
    });
    await page
        .getByRole('button', {
            name: 'Синтетический сериал Альфа',
            exact: true,
        })
        .first()
        .click();
    await expect(page.getByText(providerPlot, { exact: true })).toBeVisible();

    const open = async () => {
        await page.getByTestId('series-more-menu').click();
        await page.locator('[data-test-id="tmdb-match-menu"]').click();
        await expect(page.getByRole('dialog')).toBeVisible();
    };
    const dialog = page.getByRole('dialog');
    await open();
    await expect(dialog.getByTestId('tmdb-match-result-900101')).toBeVisible();
    await dialog.getByTestId('tmdb-match-result-900101').click();
    await expect(
        dialog.getByTestId('tmdb-match-result-900101')
    ).toHaveAttribute('aria-pressed', 'true');
    const screenshots = resolve(__dirname, '../../../dist/screenshots');
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
        animations: 'disabled',
        path: resolve(screenshots, 'tmdb-match-light.png'),
    });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(selectedPlot, { exact: true })).toBeVisible();
    await expect(
        page.getByRole('heading', {
            name: 'Синтетический эпизод Альфа',
            exact: true,
        })
    ).toBeVisible();

    // Recreating the renderer and stores must retain the user's choice.
    await page.reload();
    await page
        .getByRole('button', {
            name: 'Синтетический сериал Альфа',
            exact: true,
        })
        .first()
        .click();
    await expect(page.getByText(selectedPlot, { exact: true })).toBeVisible();
    await open();
    await dialog
        .getByRole('button', { name: 'Provider data', exact: true })
        .click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(providerPlot, { exact: true })).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'Episode 1', exact: true })
    ).toBeVisible();
    await expect(
        page.getByRole('heading', {
            name: 'Синтетический эпизод Альфа',
            exact: true,
        })
    ).toHaveCount(0);
    await page.reload();
    await page
        .getByRole('button', {
            name: 'Синтетический сериал Альфа',
            exact: true,
        })
        .first()
        .click();
    await expect(page.getByText(providerPlot, { exact: true })).toBeVisible();
    await open();
    await dialog
        .getByRole('button', { name: 'Automatic', exact: true })
        .click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(providerPlot, { exact: true })).toBeVisible();
    expect(
        await page.evaluate(() =>
            Object.keys(localStorage).filter((key) =>
                key.startsWith('iptvnator:tmdb-match:')
            )
        )
    ).toEqual([]);

    searchFails = true;
    await open();
    await expect(dialog.getByRole('alert')).toContainText(
        'TMDB search is unavailable'
    );
    searchFails = false;
    await dialog.getByRole('button', { name: 'Try again' }).click();
    await expect(dialog.getByTestId('tmdb-match-result-900101')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    const browseUrl = page.url();
    await page.goto('/workspace/settings/general');
    await page
        .locator('[data-test-id="select-theme"]')
        .getByRole('radio', { name: 'Dark', exact: true })
        .click();
    await page.locator('[data-test-id="select-language"]').click();
    const russianLocale = page.waitForResponse(
        (response) =>
            response.url().endsWith('/assets/i18n/ru.json') &&
            response.status() === 200
    );
    await page.locator('[data-test-id="ru"]').click();
    const saveAppearance = page.locator('[data-test-id="save-settings"]');
    await saveAppearance.click();
    await expect(saveAppearance).toBeHidden();
    await (await russianLocale).finished();
    await expect(
        page.getByRole('link', { name: 'Открыть настройки', exact: true })
    ).toBeVisible();
    await page.goto(browseUrl);
    await page
        .getByRole('button', {
            name: 'Синтетический сериал Альфа',
            exact: true,
        })
        .first()
        .click();
    await page.getByTestId('series-more-menu').click();
    await page.screenshot({
        animations: 'disabled',
        path: resolve(screenshots, 'tmdb-match-menu-dark.png'),
    });
    await page.locator('[data-test-id="tmdb-match-menu"]').click();
    await dialog.getByTestId('tmdb-match-result-900101').click();
    await expect(dialog).toContainText('Россия');
    await page.screenshot({
        animations: 'disabled',
        path: resolve(screenshots, 'tmdb-match-dark.png'),
    });
    await dialog
        .getByRole('button', { name: 'Данные портала', exact: true })
        .click();
    await page.screenshot({
        animations: 'disabled',
        path: resolve(screenshots, 'tmdb-match-provider.png'),
    });
    await dialog
        .getByRole('button', { name: 'Выбрать в TMDB', exact: true })
        .click();
    await page.setViewportSize({ width: 480, height: 840 });
    await expect(
        dialog.getByRole('button', { name: 'Сохранить', exact: true })
    ).toBeVisible();
    await page.screenshot({
        animations: 'disabled',
        path: resolve(screenshots, 'tmdb-match-narrow.png'),
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
});
