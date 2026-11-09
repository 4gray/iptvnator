import { expect, test } from './fixtures';
import { setSwitch } from './e2e-helpers';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addStalkerPortal,
    interceptStalkerRequests,
} from './stalker-portal.fixture';

test.use({ serviceWorkers: 'block' });

const scenarios = [
    {
        media: 'movie',
        title: 'Fictional Harbor',
        similar: 'Fictional Crossing',
        from: 'catalog',
        sameCategory: false,
    },
    {
        media: 'movie',
        title: 'Fictional Harbor',
        similar: 'Fictional Crossing',
        from: 'catalog',
        sameCategory: true,
    },
    {
        media: 'tv',
        title: 'Fictional Station',
        similar: 'Fictional Platform',
        from: 'catalog',
        sameCategory: true,
    },
    {
        media: 'movie',
        title: 'Fictional Harbor',
        similar: 'Fictional Crossing',
        from: 'search',
        sameCategory: true,
    },
] as const;

for (const { media, title, similar, from, sameCategory } of scenarios) {
    const pagedCatalog = from === 'catalog' && media === 'movie';
    const scenario = pagedCatalog
        ? `catalog (${sameCategory ? 'same category' : 'another category'})`
        : from;
    test(`@stalker shows a trailer and opens a similar ${media} from ${scenario}`, async ({
        page,
    }) => {
        const categoryId = '2001';
        const similarCategoryId = sameCategory ? categoryId : '2002';
        const row = (id: string, name: string, category = categoryId) => ({
            id,
            name,
            o_name: name,
            category_id: category,
            year: '2024',
            ...(media === 'tv' ? { is_series: '1' } : {}),
        });
        const searchPageOne = Array.from({ length: 40 }, (_, index) =>
            row(String(93000 + index), `Fictional search result ${index + 1}`)
        );
        let laterSearchPages = 0;
        let laterCatalogPages = 0;
        await configureMockProviderBackend(page);
        await interceptStalkerRequests(page);
        await page.route('**/localhost:3000/stalker**', (route) => {
            const params = new URL(route.request().url()).searchParams;
            if (
                pagedCatalog &&
                !sameCategory &&
                params.get('action') === 'get_categories' &&
                params.get('type') === 'vod'
            ) {
                return route.fulfill({
                    json: {
                        payload: {
                            js: [
                                { id: categoryId, title: 'Fixture genre' },
                                { id: similarCategoryId, title: 'Other genre' },
                            ],
                        },
                    },
                });
            }
            if (params.get('action') !== 'get_ordered_list') {
                return route.fallback();
            }
            const search = params.get('search');
            if (
                pagedCatalog &&
                !search &&
                !params.get('movie_id') &&
                params.get('category') === categoryId
            ) {
                const firstPage = params.get('p') === '1';
                if (!firstPage) laterCatalogPages++;
                const data = firstPage ? searchPageOne : [row('91001', title)];
                return route.fulfill({
                    json: { payload: { js: { data, total_items: 41 } } },
                });
            }
            if (from === 'search' && search === title) {
                if (params.get('p') === '2') laterSearchPages++;
                const data =
                    params.get('p') === '1'
                        ? searchPageOne
                        : [row('91001', title)];
                return route.fulfill({
                    json: { payload: { js: { data, total_items: 41 } } },
                });
            }
            const data =
                params.get('type') !== 'vod' || params.get('movie_id')
                    ? []
                    : search === similar
                      ? [row('91002', similar, similarCategoryId)]
                      : search && search !== title
                        ? []
                        : [row('91001', title)];
            return route.fulfill({
                json: {
                    payload: {
                        js: {
                            data,
                            total_items: data.length,
                            max_page_items: 20,
                        },
                    },
                },
            });
        });
        await page.route('https://api.themoviedb.org/**', (route) => {
            const url = new URL(route.request().url());
            const item = (id: number, name: string) => ({
                id,
                ...(media === 'movie'
                    ? {
                          title: name,
                          original_title: name,
                          release_date: '2024-05-06',
                      }
                    : {
                          name,
                          original_name: name,
                          first_air_date: '2024-05-06',
                      }),
                original_language: 'en',
                overview: 'A fictional story.',
            });
            if (url.pathname.includes('/search/')) {
                return route.fulfill({
                    json: {
                        results:
                            url.searchParams.get('query') === title
                                ? [item(91001, title)]
                                : [],
                    },
                });
            }
            return route.fulfill({
                json: {
                    ...item(91001, title),
                    videos: {
                        results: [
                            {
                                key: 'FakeClip_01',
                                site: 'YouTube',
                                type: 'Trailer',
                                official: true,
                            },
                        ],
                    },
                    recommendations: {
                        results: [
                            item(91002, similar),
                            item(91003, 'Fictional Unavailable'),
                        ],
                    },
                },
            });
        });
        await page.route('https://www.youtube-nocookie.com/**', (route) =>
            route.fulfill({
                contentType: 'text/html',
                body: '<title>Fictional trailer</title>',
            })
        );

        await page.goto('/workspace/settings/tmdb');
        await setSwitch(
            page.locator('[data-test-id="tmdb-enabled"] [role="switch"]'),
            true
        );
        await page
            .locator('[data-test-id="tmdb-api-key"]')
            .fill('fictional-fixture-key');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(
            page.getByRole('button', { name: 'Save changes' })
        ).toBeHidden();
        await page.goto('/');
        await addStalkerPortal(page, {
            name: 'Fictional Portal',
            mac: '00:1A:79:7C:00:02',
        });
        const origin = new URL(page.url()).pathname.replace(
            /\/vod(?:\/.*)?$/,
            from === 'catalog'
                ? `/vod/${categoryId}`
                : `/search?q=${encodeURIComponent(title)}`
        );
        await page.goto(origin);
        const results = page.locator(
            pagedCatalog
                ? 'app-grid-list'
                : 'app-search-layout .results-container'
        );
        if (from === 'search' || pagedCatalog) {
            await expect(
                page.getByRole('button', {
                    name: 'Fictional search result 1',
                    exact: true,
                })
            ).toBeVisible();
            await results.evaluate((element) => {
                element.scrollTop = element.scrollHeight;
            });
        }
        await page.getByRole('button', { name: title, exact: true }).click();

        const trailer = page.getByTestId(
            media === 'movie' ? 'vod-trailer' : 'series-trailer'
        );
        // WebKit does not give a button keyboard focus on pointer click.
        await trailer.focus();
        await trailer.press('Enter');
        await expect(
            page.getByRole('dialog').locator('iframe')
        ).toHaveAttribute('src', /FakeClip_01/);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(trailer).toBeFocused();

        const rail = page.locator('[data-test-id="tmdb-similar"]');
        await expect(rail).toBeVisible();
        await expect(
            rail.getByRole('button', { name: /Fictional Unavailable/ })
        ).toHaveCount(0);
        await rail.getByRole('button', { name: new RegExp(similar) }).click();
        await expect(
            page.getByRole('heading', { name: similar, exact: true })
        ).toBeVisible();
        if (pagedCatalog) {
            expect(
                new URL(page.url()).pathname.endsWith(
                    `/vod/${similarCategoryId}`
                )
            ).toBe(true);
        }
        await page.locator('[data-test-id="workspace-header-back"]').click();
        await expect(
            page.getByRole('heading', { name: title, exact: true })
        ).toBeVisible();
        expect(
            decodeURI(new URL(page.url()).pathname + new URL(page.url()).search)
        ).toBe(decodeURI(origin));
        if (from === 'search' || pagedCatalog) {
            await page
                .locator('[data-test-id="workspace-header-back"]')
                .click();
            await expect(
                results.getByRole('button', { name: title, exact: true })
            ).toBeVisible();
            await expect
                .poll(() => results.evaluate((element) => element.scrollTop))
                .toBeGreaterThan(500);
            expect(pagedCatalog ? laterCatalogPages : laterSearchPages).toBe(1);
        }
    });
}
