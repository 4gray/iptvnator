import { expect, Page, test } from '@playwright/test';
import { addSource, nav, start } from './helpers';

const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#37544b"/><circle cx="100" cy="74" r="35" fill="#a5c7b5"/><path d="M35 200v-30a65 65 0 0 1 130 0v30" fill="#a5c7b5"/></svg>';
async function setup(
    page: Page,
    provider: 'xtream' | 'stalker',
    extended = false
) {
    await start(page);
    await addSource(
        page,
        provider,
        provider === 'xtream'
            ? { username: 'marketing', password: 'marketing' }
            : {}
    );
    await nav(page, 'Movies');
    const title = await page.locator('.poster-card strong').first().innerText();
    const year = (
        await page.locator('.poster-card .muted').first().innerText()
    ).match(/(?:19|20)\d{2}/)?.[0];
    const apiPaths: string[] = [];
    await page.route('https://image.tmdb.org/**', (route) =>
        route.fulfill({ contentType: 'image/svg+xml', body: svg })
    );
    await page.route('https://api.themoviedb.org/3/**', async (route) => {
        const url = new URL(route.request().url());
        apiPaths.push(url.pathname);
        if (url.pathname.includes('/person/')) {
            const director = url.pathname.endsWith('/20');
            return route.fulfill({
                json: {
                    id: director ? 20 : 10,
                    name: director ? 'Fixture Director' : 'Fixture Actor',
                    profile_path: '/person.jpg',
                    biography:
                        'An actor and filmmaker fixture with a full filmography.'.repeat(
                            extended ? 80 : 1
                        ),
                    combined_credits: {
                        cast: director
                            ? []
                            : [
                                  ...(extended
                                      ? Array.from(
                                            { length: 100 },
                                            (_, index) => ({
                                                id: 1000 + index,
                                                title: `Archive Film ${index}`,
                                                media_type: 'movie',
                                                release_date: '2020-01-01',
                                            })
                                        )
                                      : []),
                                  {
                                      id: 501,
                                      title,
                                      media_type: 'movie',
                                      release_date: year
                                          ? `${year}-01-01`
                                          : undefined,
                                      character: 'Lead',
                                  },
                                  {
                                      id: 502,
                                      title: 'Unavailable Fixture',
                                      media_type: 'movie',
                                  },
                                  {
                                      id: 503,
                                      title: 'Foreign Show Fixture',
                                      media_type: 'tv',
                                  },
                              ],
                        crew: director
                            ? [
                                  {
                                      id: 501,
                                      title,
                                      media_type: 'movie',
                                      job: 'Director',
                                  },
                              ]
                            : [],
                    },
                },
            });
        }
        if (url.pathname.includes('/search/'))
            return route.fulfill({
                json: {
                    results: [
                        {
                            id: 700,
                            title: url.searchParams.get('query'),
                            release_date: year ? `${year}-01-01` : undefined,
                        },
                    ],
                },
            });
        await route.fulfill({
            json: {
                id: Number(url.pathname.split('/').pop()),
                title,
                release_date: year ? `${year}-01-01` : undefined,
                overview: 'TMDB description',
                original_language: 'en',
                credits: {
                    cast: [
                        {
                            id: 10,
                            name: 'Fixture Actor',
                            character: 'Lead',
                            profile_path: '/actor.jpg',
                        },
                    ],
                    crew: [
                        {
                            id: 20,
                            name: 'Fixture Director',
                            job: 'Director',
                            profile_path: '/director.jpg',
                        },
                    ],
                },
            },
        });
    });
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Metadata · TMDB', exact: false })
        .click();
    await page.getByLabel('Use TMDB metadata').check();
    await page
        .getByLabel('TMDB API key or read access token')
        .fill('fake-person-key');
    await page.getByRole('button', { name: 'Save TMDB settings' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'saved'
    );
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await expect(
        page.getByRole('button', { name: 'View filmography: Fixture Actor' })
    ).toBeVisible();
    return { title, apiPaths };
}
test('@tmdb-person a long biography scrolls with the remote and releases focus at its boundaries', async ({
    page,
}) => {
    await setup(page, 'xtream', true);
    await page
        .getByRole('button', { name: 'View filmography: Fixture Actor' })
        .click();
    const biography = page.getByLabel('Biography', { exact: true });
    await biography.focus();
    await page.keyboard.press('ArrowDown');
    await expect(biography).toBeFocused();
    expect(await biography.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('ArrowUp');
    await expect(biography).toBeFocused();
    expect(await biography.evaluate((el) => el.scrollTop)).toBe(0);
    await page.keyboard.press('ArrowUp');
    await expect(biography).not.toBeFocused();
    await biography.focus();
    await biography.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
    });
    await page.keyboard.press('ArrowDown');
    await expect(biography).not.toBeFocused();
});
test('@tmdb-person Stalker filmography finds VOD series after an unsupported series catalog and a localized-title miss', async ({
    page,
}) => {
    await setup(page, 'stalker');
    await page.route('https://api.themoviedb.org/3/person/10**', (route) =>
        route.fulfill({
            json: {
                id: 10,
                name: 'Fixture Actor',
                combined_credits: {
                    cast: [
                        {
                            id: 97546,
                            name: 'Тед Лассо',
                            original_name: 'Ted Lasso',
                            media_type: 'tv',
                            first_air_date: '2020-01-01',
                        },
                    ],
                },
            },
        })
    );
    const queries: string[] = [];
    await page.route('**/stalker?**', async (route) => {
        const url = new URL(route.request().url());
        if (
            url.searchParams.get('action') !== 'get_ordered_list' ||
            !url.searchParams.get('search')
        )
            return route.fallback();
        const type = url.searchParams.get('type');
        const query = url.searchParams.get('search');
        queries.push(`${type}:${query}`);
        const data =
            query === 'Ted Lasso'
                ? [
                      {
                          id: 'embedded-show',
                          name: 'Ted Lasso s04',
                          year: '2026',
                          series: [1, 2],
                          cmd: 'http://fixture.invalid/show',
                      },
                  ]
                : [];
        return route.fulfill({
            json: {
                action: 'get_ordered_list',
                payload: {
                    js:
                        type === 'series'
                            ? false
                            : {
                                  data,
                                  total_items: data.length,
                                  max_page_items: 14,
                              },
                },
            },
        });
    });
    await page
        .getByRole('button', { name: 'View filmography: Fixture Actor' })
        .click();
    await page.locator('[data-focus="filmography:tv:97546"]').click();
    await expect(page.locator('.detail-hero h1')).toHaveText('Ted Lasso s04');
    await expect(page.locator('.episode')).toHaveCount(2);
    expect(queries).toEqual([
        'series:Тед Лассо',
        'vod:Тед Лассо',
        'series:Ted Lasso',
        'vod:Ted Lasso',
    ]);
    await page.keyboard.press('Escape');
    await expect(
        page.locator('[data-focus="filmography:tv:97546"]')
    ).toBeFocused();
});
for (const provider of ['xtream', 'stalker'] as const) {
    test(`@tmdb-person ${provider}: round actor/director portraits open filmography and available provider details`, async ({
        page,
    }, testInfo) => {
        const { title, apiPaths } = await setup(page, provider);
        const actor = page.getByRole('button', {
            name: 'View filmography: Fixture Actor',
        });
        const geometry = await actor
            .locator('.person-avatar')
            .evaluate((el) => ({
                width: el.clientWidth,
                height: el.clientHeight,
                radius: getComputedStyle(el).borderRadius,
            }));
        expect(geometry.width).toBe(geometry.height);
        expect(geometry.radius).toBe('50%');
        await page.screenshot({
            path: testInfo.outputPath(`${provider}-people.png`),
        });
        await actor.click();
        await expect(page.locator('.person-page h1')).toHaveText(
            'Fixture Actor'
        );
        await expect(page.locator('.filmography-card')).toHaveCount(3);
        await page.locator('[data-focus="filmography:movie:502"]').click();
        await expect(page.locator('.filmography-status')).toContainText(
            'not available in this portal'
        );
        for (const width of [1920, 1280]) {
            await page.setViewportSize({ width, height: 1080 });
            expect(
                await page
                    .locator('main')
                    .evaluate((el) => el.scrollWidth <= el.clientWidth)
            ).toBe(true);
            await page.screenshot({
                path: testInfo.outputPath(
                    `${provider}-filmography-${width}.png`
                ),
            });
        }
        await page.locator('[data-focus="filmography:movie:501"]').click();
        await expect(page.locator('.detail-hero h1')).toHaveText(title);
        await expect(
            page.getByRole('button', { name: 'Watch now' })
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.person-page h1')).toHaveText(
            'Fixture Actor'
        );
        await expect(
            page.locator('[data-focus="filmography:movie:501"]')
        ).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(actor).toBeFocused();
        await page
            .getByRole('button', { name: 'View filmography: Fixture Director' })
            .click();
        await expect(page.locator('.person-page h1')).toHaveText(
            'Fixture Director'
        );
        await expect(page.locator('.filmography-card')).toHaveCount(1);
        await expect(page.locator('.filmography-card')).toContainText(
            'Director'
        );
        await page.locator('[data-focus="filmography:movie:501"]').click();
        await expect(page.locator('.detail-hero h1')).toHaveText(title);
        expect(apiPaths.filter((path) => path === '/3/person/10')).toHaveLength(
            1
        );
        expect(apiPaths).toContain('/3/person/20');
    });
}

test('@tmdb-person failed and cancelled portal searches cannot report absence or navigate from a stale response', async ({
    page,
}) => {
    await setup(page, 'stalker');
    await page
        .getByRole('button', { name: 'View filmography: Fixture Actor' })
        .click();
    let fail = true;
    let release: (() => void) | undefined;
    await page.route('**/stalker?**', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('search') !== 'Unavailable Fixture')
            return route.fallback();
        if (fail) return route.fulfill({ status: 503, json: {} });
        await new Promise<void>((resolve) => {
            release = resolve;
        });
        await route
            .fulfill({
                json: {
                    payload: {
                        js: { data: [], total_items: 0, max_page_items: 25 },
                    },
                },
            })
            .catch(() => undefined);
    });
    await page.locator('[data-focus="filmography:movie:502"]').click();
    await expect(page.locator('.filmography-status')).toContainText(
        'Could not finish'
    );
    await expect(page.locator('.filmography-status')).not.toContainText(
        'not available'
    );
    fail = false;
    await page.getByRole('button', { name: 'Retry portal search' }).click();
    await expect.poll(() => !!release).toBe(true);
    await page.getByRole('button', { name: 'Cancel search' }).click();
    await expect(
        page.locator('[data-focus="filmography:movie:502"]')
    ).toBeFocused();
    release?.();
    await nav(page, 'Home');
    await expect(page.locator('.person-page')).toHaveCount(0);
    await expect(page.locator('.detail-hero')).toHaveCount(0);
});

test('@tmdb-person complete filmography keeps virtualized card focus and scroll after a provider detail round trip', async ({
    page,
}) => {
    await setup(page, 'xtream', true);
    let fail = true;
    await page.route('https://api.themoviedb.org/3/person/10**', (route) =>
        fail ? route.fulfill({ status: 503, json: {} }) : route.fallback()
    );
    await page
        .getByRole('button', { name: 'View filmography: Fixture Actor' })
        .click();
    await expect(
        page.getByRole('button', { name: 'Retry filmography' })
    ).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Retry filmography' }).click();
    await expect(page.locator('.person-page h2')).toContainText('103');
    await page.locator('main').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
    });
    const target = page.locator('[data-focus="filmography:movie:501"]');
    await expect(target).toBeVisible();
    await target.scrollIntoViewIfNeeded();
    const scroll = await page.locator('main').evaluate((el) => el.scrollTop);
    expect(scroll).toBeGreaterThan(1000);
    await target.click();
    await expect(page.locator('.detail-hero h1')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(target).toBeFocused();
    await expect
        .poll(async () =>
            Math.abs(
                (await page.locator('main').evaluate((el) => el.scrollTop)) -
                    scroll
            )
        )
        .toBeLessThan(8);
});
