import { expect, Page, test } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';
import { resolve } from 'node:path';
import { addSource, nav, start } from './helpers';
import { checkHorizontalRail } from './horizontal-rail';

const artwork =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#234039"/><circle cx="300" cy="300" r="140" fill="#7cad98"/></svg>';

async function setup(page: Page) {
    await start(page);
    await page.route('**/xtream?**', async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        const info = {
            name: 'Fixture Title',
            releasedate: '2020-01-01',
            genre: 'Provider Adventure',
            country: 'Provider Country',
            tmdb_id: 701,
        };
        const payloads: Record<string, unknown> = {
            get_vod_streams: [
                {
                    stream_id: 41,
                    name: 'Fixture Movie',
                    year: '2020',
                    country: 'Provider Country',
                    category_id: 'fixture-category',
                    container_extension: 'mkv',
                },
            ],
            get_series: [
                {
                    series_id: 51,
                    name: 'Fixture Series',
                    year: '2020',
                    category_id: 'fixture-category',
                },
            ],
            get_vod_categories: [
                {
                    category_id: 'fixture-category',
                    category_name: 'Fixture Collection',
                },
            ],
            get_series_categories: [
                {
                    category_id: 'fixture-category',
                    category_name: 'Fixture Collection',
                },
            ],
            get_vod_info: {
                info,
                movie_data: { stream_id: 41, container_extension: 'mkv' },
            },
            get_series_info: {
                info,
                episodes: {
                    '1': [
                        {
                            id: 'fixture-episode',
                            title: 'Fixture Episode',
                            season: 1,
                            episode_num: 1,
                            container_extension: 'mkv',
                        },
                    ],
                },
            },
        };
        if (action && action in payloads)
            return route.fulfill({ json: { payload: payloads[action] } });
        return route.fallback();
    });
    await addSource(page, 'xtream', {
        name: 'Fixture Source',
        username: 'marketing',
        password: 'marketing',
    });
    await page.route('https://image.tmdb.org/**', (route) =>
        route.fulfill({ contentType: 'image/svg+xml', body: artwork })
    );
}

async function enable(page: Page) {
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Metadata · TMDB', exact: false })
        .click();
    await page.getByLabel('Use TMDB metadata').check();
    await page
        .getByLabel('TMDB API key or read access token')
        .fill('fixture-key');
    await page.getByRole('button', { name: 'Save TMDB settings' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'saved'
    );
}

for (const kind of ['movie', 'series'] as const) {
    test(`@tmdb ${kind} details combine people, expose metadata chips and preserve remote focus`, async ({
        page,
    }) => {
        await setup(page);
        const author =
            kind === 'movie' ? 'Fixture Director' : 'Fixture Creator';
        const paths: string[] = [];
        await page.route('https://api.themoviedb.org/3/**', (route) => {
            const url = new URL(route.request().url());
            paths.push(url.pathname);
            const details = {
                id: 701,
                title: 'Fixture Movie',
                name: 'Fixture Series',
                release_date: '2020-01-01',
                first_air_date: '2020-01-01',
                overview:
                    'A synthetic description for TV detail layout verification.',
                poster_path: '/fixture.jpg',
                original_language: 'en',
                genres: [
                    { id: 12, name: 'Adventure' },
                    { id: 12, name: 'Adventure' },
                    { id: 18, name: 'Drama' },
                ],
                production_countries: [
                    { iso_3166_1: 'XY', name: 'Fictionland' },
                ],
                runtime: 110,
                episode_run_time: [45],
                vote_count: 25,
                vote_average: 7.6,
                credits: {
                    cast: [
                        {
                            id: 10,
                            name: 'Fixture Actor',
                            character: 'Fixture Character',
                        },
                        { id: 20, name: author, character: 'Cameo' },
                        { id: 30, name: author, character: 'Different person' },
                        ...Array.from({ length: 9 }, (_, index) => ({
                            id: 100 + index,
                            name: `Fixture Guest ${index + 1}`,
                            character: `Character ${index + 1}`,
                        })),
                    ],
                    crew: [{ id: 20, name: author, job: 'Director' }],
                },
                created_by: [{ id: 20, name: author }],
            };
            return route.fulfill({
                json: url.pathname.includes('/person/')
                    ? {
                          id: 10,
                          name: 'Fixture Actor',
                          biography: 'Synthetic person biography.',
                          combined_credits: { cast: [], crew: [] },
                      }
                    : url.pathname.includes('/season/')
                      ? { episodes: [] }
                      : url.pathname.includes('/search/')
                        ? { results: [details] }
                        : details,
            });
        });
        await enable(page);
        await nav(page, kind === 'movie' ? 'Movies' : 'Series');
        await page.locator('.poster-card').first().click();
        const credits = page.getByRole('region', { name: 'TMDB credits' });
        await expect(credits.getByRole('heading')).toHaveText(
            `${kind === 'movie' ? 'Directors' : 'Creators'} & cast`
        );
        await expect(credits.locator('ul')).toHaveCount(1);
        const people = credits.locator('.person-chip');
        await expect(people).toHaveCount(10);
        await checkHorizontalRail(page, credits.locator('ul'));
        await expect(page.locator('.detail-hero')).toBeVisible();
        await expect(people.first()).toContainText(author);
        await expect(people.first().locator('small')).toHaveText(
            kind === 'movie' ? 'Director' : 'Creator'
        );
        await expect(
            credits.getByRole('button', { name: `View filmography: ${author}` })
        ).toHaveCount(2);
        const chips = page.getByRole('list', { name: 'Title information' });
        await expect(
            chips.getByLabel('Year: 2020', { exact: true })
        ).toHaveCount(1);
        await expect(
            chips.getByLabel('Genre: Adventure', { exact: true })
        ).toHaveCount(1);
        await expect(
            chips.getByLabel('Country: Fictionland', { exact: true })
        ).toBeVisible();
        await expect(
            chips.getByLabel(
                'Playlist category: Category · Fixture Collection',
                { exact: true }
            )
        ).toBeVisible();
        await expect(
            chips.getByLabel(
                `Duration: ${kind === 'movie' ? '110 min' : '45 min / episode'}`,
                { exact: true }
            )
        ).toBeVisible();
        await expect(
            chips.getByLabel('TMDB rating: TMDB 7.6', { exact: true })
        ).toBeVisible();
        await expect(chips.locator('button, [tabindex]')).toHaveCount(0);
        const detailRequests = paths.filter((path) =>
            /^\/3\/(movie|tv)\/701$/.test(path)
        ).length;
        await people.first().focus();
        await page.keyboard.press('ArrowRight');
        await expect(people.nth(1)).toBeFocused();
        expect(
            paths.filter((path) => /^\/3\/(movie|tv)\/701$/.test(path))
        ).toHaveLength(detailRequests);
        await page.keyboard.press('Enter');
        await expect(page.locator('.person-page h1')).toHaveText(
            'Fixture Actor'
        );
        await page.keyboard.press('Escape');
        await expect(people.nth(1)).toBeFocused();
        for (let index = 1; index < 9; index++)
            await page.keyboard.press('ArrowRight');
        await expect(people.last()).toBeFocused();
        await expect
            .poll(() =>
                credits.locator('ul').evaluate((element) => element.scrollLeft)
            )
            .toBeGreaterThan(0);
        await people.first().focus();
        for (const width of [1920, 1280]) {
            await page.setViewportSize({
                width,
                height: width === 1920 ? 1080 : 720,
            });
            await page.locator('[data-focus="detail-play"]').focus();
            await page.locator('main').evaluate((element) => {
                element.scrollTop = 0;
            });
            await expect(chips).toBeVisible();
            await credits.screenshot({
                path: resolve(
                    workspaceRoot,
                    'dist/test-results/tv-e2e',
                    `credits-rail-${kind}-${width}.png`
                ),
            });
            await page.locator('[data-focus="detail-play"]').focus();
            await page.locator('main').evaluate((element) => {
                element.scrollTop = 0;
            });
            await page.screenshot({
                path: resolve(
                    workspaceRoot,
                    'dist/test-results/tv-e2e',
                    `detail-${kind}-${width}.png`
                ),
            });
            expect(
                await page
                    .locator('main')
                    .evaluate(
                        (element) => element.scrollWidth <= element.clientWidth
                    )
            ).toBe(true);
        }
    });
}

test('provider-only details show supplied chips without requesting TMDB or rendering empty credits', async ({
    page,
}) => {
    await setup(page);
    await page.route('**/xtream?**', (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_vod_info'
        )
            return route.fallback();
        return route.fulfill({
            json: {
                payload: {
                    info: {
                        releasedate: '1895-03-04',
                        genre: 'Provider Adventure',
                        country: 'N/A',
                    },
                },
            },
        });
    });
    let requests = 0;
    await page.route('https://api.themoviedb.org/3/**', (route) => {
        requests++;
        return route.abort();
    });
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    const chips = page.getByRole('list', { name: 'Title information' });
    await expect(chips).toContainText('Provider Adventure');
    await expect(chips).toContainText('Provider Country');
    await expect(chips.getByLabel('Year: 1895', { exact: true })).toBeVisible();
    await expect(chips).toContainText('Category · Fixture Collection');
    await expect(page.locator('.metadata-credits')).toHaveCount(0);
    await expect(chips).not.toContainText('TMDB');
    expect(requests).toBe(0);
});

test('provider-only Stalker series displays genres_str with no TMDB requests', async ({
    page,
}) => {
    await start(page);
    await page.route('**/stalker?**', (route) => {
        const params = new URL(route.request().url()).searchParams;
        const action = params.get('action');
        if (action === 'get_categories')
            return route.fulfill({
                json: {
                    payload: {
                        js: [{ id: '77', title: 'Fixture Collection' }],
                    },
                },
            });
        if (action !== 'get_ordered_list') return route.fallback();
        const data = params.has('movie_id')
            ? []
            : [
                  {
                      id: '42',
                      name: 'Fixture Series',
                      category_id: '77',
                      genre: '',
                      genres_str: 'Fixture Adventure, Fixture Drama',
                      country: 'Fixture Country',
                      year: '2020',
                  },
              ];
        return route.fulfill({
            json: {
                payload: {
                    js: { data, total_items: data.length, max_page_items: 14 },
                },
            },
        });
    });
    let requests = 0;
    await page.route('https://api.themoviedb.org/3/**', (route) => {
        requests++;
        return route.abort();
    });
    await addSource(page, 'stalker', { name: 'Fixture Stalker Source' });
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    const chips = page.getByRole('list', { name: 'Title information' });
    await expect(
        chips.getByLabel('Genre: Fixture Adventure', { exact: true })
    ).toBeVisible();
    await expect(
        chips.getByLabel('Genre: Fixture Drama', { exact: true })
    ).toBeVisible();
    await expect(
        chips.getByLabel('Playlist category: Category · Fixture Collection', {
            exact: true,
        })
    ).toBeVisible();
    expect(requests).toBe(0);
});
