import { expect, test } from '@playwright/test';
import { fillTvField, addSource, nav, start } from './helpers';

for (const index of [30, 120])
    test(`@tmdb a long season stays a windowed rail; delayed stills keep focus on episode ${index + 1}`, async ({
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
        await fillTvField(
            page.getByLabel('TMDB API key or read access token'),
            'fake-key'
        );
        await page.getByRole('button', { name: 'Save TMDB settings' }).click();
        await expect(
            page.locator('.tmdb-settings [role=status]')
        ).toContainText('saved');
        await nav(page, 'Series');
        await page.locator('.poster-card').first().click();
        await expect.poll(() => !!release).toBe(true);
        const rail = page.locator('.episode-rail');
        await expect(rail.locator('.episode').first()).toBeVisible();
        await rail.locator('.episode').first().focus();
        for (let next = 1; next <= index; next++) {
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('.episode:focus')).toHaveAttribute(
                'data-episode-index',
                String(next)
            );
        }
        const chosen = rail.locator(`[data-episode-index="${index}"]`);
        await expect(chosen).toBeFocused();
        // Only a window around the selected episode is in the DOM.
        expect(await rail.locator('.episode').count()).toBeLessThanOrEqual(24);
        await expect(page.locator('.episode-focus')).toContainText(
            `Anchored episode ${index + 1}`
        );
        // Layout position in the rail: the focus scale transition does not count.
        const position = () =>
            chosen.evaluate(
                (el) =>
                    (el as HTMLElement).offsetLeft -
                    (el.parentElement?.scrollLeft ?? 0)
            );
        const before = await position();
        release!();
        await expect(chosen.locator('.episode-still')).toBeVisible();
        await expect(chosen).toBeFocused();
        expect(Math.abs((await position()) - before)).toBeLessThan(2);
        await page.keyboard.press('ArrowDown');
        await expect(
            page.locator('[data-focus="episode-options"]')
        ).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(chosen).toBeFocused();
        // Pointer or wheel scrolling to the end renders the episodes there
        // instead of empty spacer, and keeps the focused episode mounted.
        await rail.evaluate((el) => {
            el.scrollLeft = el.scrollWidth;
        });
        await expect(rail.locator('[data-episode-index="199"]')).toBeVisible();
        await expect(chosen).toBeFocused();
        // Scrolling back to the start puts the window before the focused
        // episode; its button must survive the split.
        await rail.evaluate((el) => {
            el.scrollLeft = 0;
        });
        await expect(rail.locator('[data-episode-index="0"]')).toBeVisible();
        await expect(chosen).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('.player-bottom')).toContainText(
            `Anchored episode ${index + 1}`
        );
    });
