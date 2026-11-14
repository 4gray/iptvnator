import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { setSwitch } from './e2e-helpers';
import { configureMockProviderBackend } from './provider-target-route';
import {
    addStalkerPortal,
    interceptStalkerRequests,
} from './stalker-portal.fixture';
import {
    addXtreamPortal,
    interceptXtreamRequests,
} from './xtream-series-playback.fixture';

const alpha = {
    id: 99001,
    title: 'Synthetic Discovery Film Alpha',
    release_date: '2022-02-03',
};
const beta = {
    id: 99002,
    title: 'Synthetic Discovery Film Beta',
    release_date: '2022-02-04',
};

test.use({ serviceWorkers: 'block' });

function discoverUrl(page: Page, year: number): string {
    const url = new URL(page.url());
    url.pathname = url.pathname.replace(/\/vod(?:\/.*)?$/, '/discover');
    url.search = `type=movie&year=${year}`;
    return url.href;
}

async function enableTmdb(page: Page): Promise<void> {
    await expect(page).toHaveURL(/\/workspace\/settings\/tmdb$/);
    await setSwitch(
        page.locator('[data-test-id="tmdb-enabled"] [role="switch"]'),
        true
    );
    await page.locator('[data-test-id="tmdb-api-key"]').fill('fixture-key');
    const save = page.getByRole('button', { name: 'Save changes' });
    await save.click();
    await expect(save).toBeHidden();
}

test('@web @pwa @xtream Discover distinguishes request and filter states', async ({
    page,
}) => {
    await configureMockProviderBackend(page);
    await interceptXtreamRequests(page);
    await page.route('**/localhost:3000/xtream**', (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        if (action === 'get_vod_categories') {
            return route.fulfill({
                json: {
                    payload: [
                        {
                            category_id: '801',
                            category_name: 'Synthetic Category',
                        },
                    ],
                },
            });
        }
        if (action === 'get_vod_streams') {
            return route.fulfill({
                json: {
                    payload: [
                        {
                            stream_id: 8101,
                            category_id: '801',
                            stream_type: 'movie',
                            name: `${alpha.title} (2022)`,
                        },
                    ],
                },
            });
        }
        return route.fallback();
    });
    let requests = 0;
    await page.route('https://api.themoviedb.org/**', (route) => {
        const url = new URL(route.request().url());
        if (!url.pathname.endsWith('/discover/movie')) {
            return route.fulfill({ json: { results: [] } });
        }
        if (++requests === 1) {
            return route.fulfill({ status: 503, json: {} });
        }
        const year = url.searchParams.get('primary_release_year');
        return route.fulfill({
            json: {
                results:
                    year === '2022'
                        ? [alpha, beta]
                        : year === '2023'
                          ? [beta]
                          : [],
                total_pages: 1,
            },
        });
    });
    await page.goto('/');
    await addXtreamPortal(page, { name: 'Synthetic Xtream Source' });
    const initialUrl = discoverUrl(page, 2022);
    const noLibraryUrl = discoverUrl(page, 2023);
    const emptyUrl = discoverUrl(page, 2024);
    await page.goto(initialUrl);
    const discover = page.locator('app-discover-view');
    await expect(
        discover.getByText('Enable TMDB metadata to use Discover.')
    ).toBeVisible();
    expect(requests).toBe(0);
    await discover.getByRole('link', { name: 'Open settings' }).click();
    await enableTmdb(page);

    await page.goto(initialUrl);
    await expect(
        discover.getByText('Could not load titles from TMDB.')
    ).toBeVisible();
    await discover.getByRole('button', { name: 'Retry', exact: true }).click();
    const all = discover.getByRole('button', { name: 'All (2)', exact: true });
    const library = discover.getByRole('button', {
        name: 'In your library (1)',
        exact: true,
    });
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await library.click();
    await expect(library).toHaveAttribute('aria-pressed', 'true');
    await expect(
        discover.getByText(alpha.title, { exact: true })
    ).toBeVisible();
    await expect(discover.getByText(beta.title, { exact: true })).toHaveCount(
        0
    );

    await page.goto(noLibraryUrl);
    await discover
        .getByRole('button', { name: 'In your library (0)', exact: true })
        .click();
    await expect(
        discover.getByText('No matches in your library for these titles.')
    ).toBeVisible();
    await discover.getByRole('button', { name: 'Show all titles' }).click();
    await expect(
        discover.getByRole('button', { name: 'All (1)', exact: true })
    ).toBeFocused();
    await expect(discover.getByText(beta.title, { exact: true })).toBeVisible();

    await page.goto(emptyUrl);
    await expect(
        discover.getByText('No titles found for this selection.')
    ).toBeVisible();
    await expect(
        discover.getByRole('button', { name: 'Retry', exact: true })
    ).toHaveCount(0);
});

test('@web @pwa @stalker Discover offers search for unchecked titles', async ({
    page,
}) => {
    await configureMockProviderBackend(page);
    await interceptStalkerRequests(page);
    await page.route('https://api.themoviedb.org/**', (route) =>
        route.fulfill({ json: { results: [alpha], total_pages: 1 } })
    );
    await page.goto('/workspace/settings/tmdb');
    await enableTmdb(page);
    await page.goto('/');
    await addStalkerPortal(page, { name: 'Synthetic Stalker Source' });
    await page.goto(discoverUrl(page, 2022));

    const discover = page.locator('app-discover-view');
    const card = discover.getByRole('button', {
        name: /Synthetic Discovery Film Alpha/,
    });
    await expect(card.getByText('Search in portal')).toBeVisible();
    await expect(card.locator('.title-results__poster')).toHaveCSS(
        'opacity',
        '1'
    );
    await expect(
        discover.getByRole('button', { name: /In your library/ })
    ).toHaveCount(0);
    await card.click();
    await expect(page).toHaveURL(/\/stalker\/[^/]+\/search\?q=Synthetic/);
});
