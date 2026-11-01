import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import { setSwitch } from './e2e-helpers';
import {
    addXtreamPortal,
    interceptXtreamRequests,
    MOCK_SERVER,
    DEFAULT_USERNAME,
    DEFAULT_PASSWORD,
} from './xtream-series-playback.fixture';

test('@tmdb-match corrects an Xtream movie through its route menu', async ({
    page,
    request,
}) => {
    test.setTimeout(120_000);
    await configureMockProviderBackend(page);
    await interceptXtreamRequests(page);
    const params = { username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD };
    const listing = await request.get(`${MOCK_SERVER}/player_api.php`, {
        params: { ...params, action: 'get_vod_streams' },
    });
    const movie = (await listing.json())[0];
    const providerPlot = 'The original provider movie description.';
    // The mock generates a new plot for each request; pin it across reloads.
    await page.route('**/localhost:3000/xtream**', async (route) => {
        const original = new URL(route.request().url());
        if (original.searchParams.get('action') !== 'get_vod_info')
            return route.fallback();
        const url = new URL(`${MOCK_SERVER}/xtream`);
        original.searchParams.forEach((value, key) => {
            if (key !== 'targetId') url.searchParams.set(key, value);
        });
        const response = await route.fetch({ url: url.toString() });
        const body = await response.json();
        body.payload.info.plot = providerPlot;
        body.payload.info.description = providerPlot;
        await route.fulfill({ response, json: body });
    });
    const manualPlot = 'The movie selected manually in TMDB.';
    await page.route('https://api.themoviedb.org/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({
            json: path.includes('/search/')
                ? {
                      results: [
                          {
                              id: 999,
                              title: movie.name,
                              original_title: movie.name,
                          },
                      ],
                  }
                : {
                      id: Number(path.split('/').pop()),
                      title: movie.name,
                      overview: path.endsWith('/999')
                          ? manualPlot
                          : 'The automatically matched movie.',
                      credits: { cast: [], crew: [] },
                  },
        });
    });
    await page.goto('/workspace/settings/tmdb');
    await setSwitch(
        page.locator('[data-test-id="tmdb-enabled"] [role="switch"]'),
        true
    );
    await page.locator('[data-test-id="tmdb-api-key"]').fill('fixture-key');
    const settingsSave = page.getByRole('button', { name: 'Save changes' });
    await settingsSave.click();
    await expect(settingsSave).toBeHidden();
    await page.goto('/');
    await addXtreamPortal(page);
    await page
        .locator(`[data-category-id="${movie.category_id}"]`)
        .first()
        .click();
    await page.getByText(movie.name, { exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    const open = async () => {
        await page.getByTestId('vod-more-menu').click();
        await page.locator('[data-test-id="tmdb-match-menu"]').click();
        await expect(dialog).toBeVisible();
    };
    await open();
    await dialog.getByTestId('tmdb-match-result-999').click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
        page.getByText(manualPlot, { exact: true }).first()
    ).toBeVisible();
    await page.reload();
    await expect(
        page.getByText(manualPlot, { exact: true }).first()
    ).toBeVisible();
    await open();
    await dialog
        .getByRole('button', { name: 'Provider data', exact: true })
        .click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
        page.getByText(providerPlot, { exact: true }).first()
    ).toBeVisible();
    await expect(page.getByText(manualPlot, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(
        page.getByText(providerPlot, { exact: true }).first()
    ).toBeVisible();
});
