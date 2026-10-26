import { expect, test } from '@playwright/test';
import { addSource, nav, start } from './helpers';

const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="170"><rect width="300" height="170" fill="#275947"/></svg>';

test('@tmdb checking a valid key explains that metadata is disabled and unsaved', async ({
    page,
}) => {
    await start(page);
    await page.route('https://api.themoviedb.org/3/**', (route) =>
        route.fulfill({ json: {} })
    );
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Metadata · TMDB', exact: false })
        .click();
    await page.getByLabel('TMDB API key or read access token').fill('fake-key');
    await page.getByRole('button', { name: 'Check TMDB key' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'Metadata is disabled'
    );
    await expect(page.locator('.tmdb-state')).toContainText('Unsaved changes');
    await page.getByLabel('Use TMDB metadata').check();
    await page.getByRole('button', { name: 'Save TMDB settings' }).click();
    await expect(page.locator('.tmdb-state')).toHaveText(
        'Metadata is enabled on this TV.'
    );
    await page.reload();
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Metadata · TMDB', exact: false })
        .click();
    await expect(page.getByLabel('Use TMDB metadata')).toBeChecked();
});

test('@tmdb credits and season stills/descriptions preserve episode playback and series identity after relaunch', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await page.route('**/xtream?**', async (route) => {
        if (
            new URL(route.request().url()).searchParams.get('action') !==
            'get_series_info'
        )
            return route.fallback();
        const response = await route.fetch();
        const body = await response.json();
        for (const episodes of Object.values(body.payload.episodes ?? {}))
            if (Array.isArray(episodes))
                episodes.forEach((episode) => {
                    if (episode.info) delete episode.info.movie_image;
                });
        await route.fulfill({ response, json: body });
    });
    const paths: string[] = [];
    let failSeason = true;
    await page.route('https://image.tmdb.org/**', (route) =>
        route.fulfill({ contentType: 'image/svg+xml', body: svg })
    );
    await page.route('https://api.themoviedb.org/3/**', async (route) => {
        const url = new URL(route.request().url());
        paths.push(url.pathname);
        if (url.pathname.includes('/season/')) {
            if (failSeason) return route.fulfill({ status: 503, json: {} });
            return route.fulfill({
                json: {
                    episodes: [
                        {
                            episode_number: 1,
                            name: 'TMDB episode',
                            overview: 'Season episode description',
                            still_path: '/episode.jpg',
                        },
                    ],
                },
            });
        }
        await route.fulfill({
            json: url.pathname.includes('/search/')
                ? {
                      results: [
                          {
                              id: 701,
                              name: url.searchParams.get('query'),
                              first_air_date: '1900-01-01',
                          },
                      ],
                  }
                : {
                      id: 701,
                      original_language: 'en',
                      overview: 'Show description',
                      backdrop_path: '/wide.jpg',
                      credits: {
                          cast: [
                              {
                                  name: 'Fixture Actor',
                                  character: 'Fixture Character',
                              },
                          ],
                      },
                      created_by: [{ name: 'Fixture Creator' }],
                  },
        });
    });
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Metadata · TMDB', exact: false })
        .click();
    await page.getByLabel('Use TMDB metadata').check();
    await page.getByLabel('TMDB API key or read access token').fill('fake-key');
    await page.getByRole('button', { name: 'Save TMDB settings' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'saved'
    );
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    const seriesTitle = await page.locator('.detail-hero h1').innerText();
    await expect(
        page.getByRole('region', { name: 'TMDB credits' })
    ).toContainText('Fixture Actor');
    await expect(
        page.getByRole('region', { name: 'TMDB credits' })
    ).toContainText('Fixture Creator');
    await expect(
        page.getByRole('button', { name: 'Retry episode metadata' })
    ).toBeVisible();
    await expect(page.locator('.episode').first()).toBeVisible();
    expect(
        await page
            .locator('.episode')
            .first()
            .evaluate((el) => el.getBoundingClientRect().height)
    ).toBe(260);
    failSeason = false;
    await page.getByRole('button', { name: 'Retry episode metadata' }).click();
    await expect(page.locator('.episode-description').first()).toHaveText(
        'Season episode description'
    );
    await expect(page.locator('.episode-still').first()).toHaveAttribute(
        'src',
        /\/episode.jpg$/
    );
    await expect(page.locator('.episode-still').first()).toBeVisible();
    expect(
        await page
            .locator('.episode')
            .first()
            .evaluate((el) => el.getBoundingClientRect().height)
    ).toBe(480);
    expect(
        await page
            .locator('.episode')
            .nth(1)
            .evaluate((el) => el.getBoundingClientRect().height)
    ).toBe(260);
    expect(
        await page
            .locator('.episode-still')
            .first()
            .evaluate((el) => el.getBoundingClientRect().width)
    ).toBeGreaterThan(120);
    const seriesCover = await page
        .locator('.detail-poster img')
        .getAttribute('src');
    await page.screenshot({
        path: '../../dist/tv-verification/tv-rich-episodes.png',
    });
    const title = await page.locator('.episode strong').first().innerText();
    // Meaningful provider episode titles are retained.
    expect(title).not.toBe('TMDB episode');
    await page.locator('.episode').first().click();
    await expect(page.locator('.player-bottom h1')).toHaveText(seriesTitle);
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(0.1);
    await page.getByLabel('Playback position').fill('8');
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate(
                    (v: HTMLVideoElement) => !v.seeking && v.currentTime >= 8
                )
        )
        .toBe(true);
    await page.getByRole('button', { name: 'Pause', exact: false }).click();
    await page.keyboard.press('Escape');
    await nav(page, 'Home');
    await expect(page.locator('.hero h1')).toHaveText(seriesTitle);
    await expect(page.locator('.hero-position')).toContainText(title);
    await expect(page.locator('.resume-card img').first()).toHaveAttribute(
        'src',
        seriesCover!
    );
    await page.reload();
    await expect(page.locator('.hero h1')).toHaveText(seriesTitle);
    await page.locator('[data-focus="hero-resume"]').click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(7);
    expect(paths.some((path) => /\/tv\/701\/season\/1$/.test(path))).toBe(true);
});

test('@tmdb a late season response cannot replace episodes of another selected series', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    const ids = new Map<string, number>();
    let release: (() => void) | undefined;
    let firstSeason = true;
    await page.route('https://api.themoviedb.org/3/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.includes('/search/')) {
            const title = url.searchParams.get('query') ?? '';
            if (!ids.has(title)) ids.set(title, 701 + ids.size);
            return route.fulfill({
                json: {
                    results: [
                        {
                            id: ids.get(title),
                            name: title,
                            first_air_date: '1900-01-01',
                        },
                    ],
                },
            });
        }
        if (url.pathname.includes('/season/')) {
            if (firstSeason) {
                firstSeason = false;
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
                await route
                    .fulfill({
                        json: {
                            episodes: [
                                {
                                    episode_number: 1,
                                    overview: 'Obsolete episode description',
                                },
                            ],
                        },
                    })
                    .catch(() => undefined);
            } else
                await route.fulfill({
                    json: {
                        episodes: [
                            {
                                episode_number: 1,
                                overview: 'Current episode description',
                            },
                        ],
                    },
                });
            return;
        }
        await route.fulfill({
            json: {
                id: Number(url.pathname.split('/').pop()),
                original_language: 'en',
                overview: 'Series overview',
            },
        });
    });
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Metadata · TMDB', exact: false })
        .click();
    await page.getByLabel('Use TMDB metadata').check();
    await page.getByLabel('TMDB API key or read access token').fill('fake-key');
    await page.getByRole('button', { name: 'Save TMDB settings' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'saved'
    );
    await nav(page, 'Series');
    await page.locator('.poster-card').first().click();
    await expect.poll(() => !!release).toBe(true);
    await page.keyboard.press('Escape');
    await page.locator('.poster-card').nth(1).click();
    await expect(page.locator('.episode-description').first()).toHaveText(
        'Current episode description'
    );
    release?.();
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                )
            )
    );
    await expect(page.locator('.episode-description').first()).toHaveText(
        'Current episode description'
    );
    await expect(page.getByText('Obsolete episode description')).toHaveCount(0);
});
