import { expect, test } from '@playwright/test';
import { addSource, nav, start } from './helpers';

for (const index of [72, 180])
    test(`@tmdb delayed episode stills preserve focused episode ${index + 1} and its viewport anchor`, async ({
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
            const first = (
                Object.values(body.payload.episodes)[0] as Record<
                    string,
                    unknown
                >[]
            )[0];
            body.payload.episodes = {
                '1': Array.from({ length: 200 }, (_, i) => ({
                    ...first,
                    id: String(900001 + i),
                    season: 1,
                    episode_num: i + 1,
                    title: `Anchored episode ${i + 1}`,
                    info: { ...(first.info as object), movie_image: '' },
                })),
            };
            await route.fulfill({ response, json: body });
        });
        let release: (() => void) | undefined;
        await page.route('https://image.tmdb.org/**', (route) =>
            route.fulfill({
                contentType: 'image/svg+xml',
                body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="170"><rect width="300" height="170" fill="#275947"/></svg>',
            })
        );
        await page.route('https://api.themoviedb.org/3/**', async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.includes('/season/')) {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
                return route.fulfill({
                    json: {
                        episodes: Array.from({ length: 200 }, (_, i) => ({
                            episode_number: i + 1,
                            still_path: '/episode.jpg',
                            overview: `Overview ${i + 1}`,
                        })),
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
                          overview: 'Series overview',
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
            .fill('fake-key');
        await page.getByRole('button', { name: 'Save TMDB settings' }).click();
        await expect(
            page.locator('.tmdb-settings [role=status]')
        ).toContainText('saved');
        await nav(page, 'Series');
        await page.locator('.poster-card').first().click();
        await expect.poll(() => !!release).toBe(true);
        await expect(
            page.locator('.virtual-collection[data-loaded="200"]')
        ).toBeVisible();
        const columns = await page
            .locator('.episode-grid')
            .evaluate(
                (el) =>
                    getComputedStyle(el).gridTemplateColumns.split(' ').length
            );
        await page.locator('.episode').first().focus();
        for (let next = columns; next <= index; next += columns) {
            await page.keyboard.press('ArrowDown');
            await expect(page.locator('.episode:focus')).toHaveAttribute(
                'data-virtual-index',
                String(next)
            );
        }
        const chosen = page.locator(`.episode[data-virtual-index="${index}"]`);
        await expect(chosen).toBeFocused();
        const before = await chosen.evaluate(
            (el) => el.getBoundingClientRect().top
        );
        release!();
        await expect(page.locator('.rich-episodes')).toBeVisible();
        await page.evaluate(
            () =>
                new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => resolve())
                    )
                )
        );
        await expect(chosen).toBeFocused();
        await expect
            .poll(() =>
                chosen.evaluate(
                    (el, top) => Math.abs(el.getBoundingClientRect().top - top),
                    before
                )
            )
            .toBeLessThan(2);
        expect(await page.locator('.episode').count()).toBeLessThanOrEqual(30);
        await page.keyboard.press('Enter');
        await expect(page.locator('.player-bottom')).toContainText(
            `Anchored episode ${index + 1}`
        );
    });
