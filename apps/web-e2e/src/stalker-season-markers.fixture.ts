import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/** Complete lazy VOD season workflow, using fictional provider/TMDB replies. */
export async function verifyStalkerSeasonMarkers(
    page: Page,
    addPortal: () => Promise<void>
): Promise<void> {
    const titles = ['Signal House s02', 'Сигнальный дом (3 сезон)'];
    const seasonRequests: number[] = [];
    const searchLanguages: string[] = [];
    await page.route('https://api.themoviedb.org/**', async (route) => {
        const url = new URL(route.request().url());
        const seasonMatch = url.pathname.match(/\/tv\/777\/season\/(\d+)$/);
        if (seasonMatch) {
            const season = Number(seasonMatch[1]);
            seasonRequests.push(season);
            return route.fulfill({
                json: {
                    season_number: season,
                    overview: `Season ${season} overview`,
                    episodes: [
                        {
                            episode_number: 1,
                            season_number: season,
                            name: `Season ${season} premiere`,
                            overview: `Season ${season} episode plot`,
                            still_path: `/season-${season}.jpg`,
                        },
                    ],
                },
            });
        }
        const details = {
            id: 777,
            name: 'Signal House',
            original_name: 'Signal House',
            original_language: 'en',
            first_air_date: '2024-01-01',
            overview: 'A fictional series.',
            vote_count: 500,
            vote_average: 7,
            genres: [],
            credits: { cast: [], crew: [] },
        };
        if (url.pathname.endsWith('/search/tv')) {
            searchLanguages.push(url.searchParams.get('language') ?? '');
            return route.fulfill({
                json: {
                    results: [
                        {
                            ...details,
                            name: /[а-я]/i.test(
                                url.searchParams.get('query') ?? ''
                            )
                                ? 'Сигнальный дом'
                                : details.name,
                        },
                    ],
                },
            });
        }
        return route.fulfill({ json: details });
    });
    await page.route('https://image.tmdb.org/**', (route) =>
        route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
        })
    );
    await page.route('**/localhost:3000/stalker**', async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (
            params.get('action') !== 'get_ordered_list' ||
            params.get('type') !== 'vod'
        )
            return route.fallback();
        const movieId = params.get('movie_id');
        const rows = !movieId
            ? titles.map((name, index) => ({
                  id: String(99001 + index),
                  name,
                  o_name: name,
                  is_series: '1',
                  category_id: '2001',
              }))
            : params.has('season_id')
              ? [
                    {
                        id: `episode-${movieId}`,
                        is_episode: true,
                        series_number: 1,
                        name: 'Episode 1',
                    },
                ]
              : [
                    {
                        id: 'provider-season-1',
                        video_id: movieId,
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
    await page.locator('[data-test-id="tmdb-enabled"] input').check();
    await page.locator('[data-test-id="tmdb-api-key"]').fill('e2e-key');
    const save = page.getByRole('button', { name: 'Save changes' });
    await save.click();
    await expect(save).toBeHidden();
    await page.goto('/');
    await addPortal();
    for (const [index, title] of titles.entries()) {
        const season = index + 2;
        await page.getByText(title, { exact: true }).first().click();
        await expect(
            page.getByRole('tab', { name: `Season ${season}`, exact: true })
        ).toBeVisible();
        await expect(page.getByTestId('series-quick-start')).toContainText(
            `S0${season}E01`
        );
        await expect(
            page.getByRole('heading', {
                name: `1. Season ${season} premiere`,
                exact: true,
            })
        ).toBeVisible();
        await expect(page.getByTestId('season-description')).toContainText(
            `Season ${season} overview`
        );
        await expect(page.locator('.episode-card')).toContainText(
            `Season ${season} episode plot`
        );
        await expect(page.locator('.episode-card img')).toHaveAttribute(
            'src',
            new RegExp(`/season-${season}\\.jpg$`)
        );
        await page.locator('[data-test-id="toggle-season-watched"]').click();
        await expect(page.locator('.episode-card--watched')).toHaveCount(1);
        await page.getByRole('button', { name: 'Back', exact: true }).click();
    }
    await page.getByText(titles[0], { exact: true }).first().click();
    await expect(
        page.getByRole('tab', { name: 'Season 2', exact: true })
    ).toBeVisible();
    await expect(page.locator('.episode-card--watched')).toHaveCount(1);
    expect(seasonRequests).toEqual(expect.arrayContaining([2, 3]));
    expect(seasonRequests).not.toContain(1);
    expect(searchLanguages).toEqual(expect.arrayContaining(['en-US', 'ru-RU']));
}
