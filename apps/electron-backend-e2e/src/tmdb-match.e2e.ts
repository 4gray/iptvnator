import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickGridListCardByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    resetMockServers,
    saveSettings,
    setSwitch,
    test,
    waitForXtreamWorkspaceReady,
    xtreamMockServer,
} from './electron-test-fixtures';
import { fetchXtreamVodFixture, getXtreamTitle } from './portal-mock-fixtures';

test('@tmdb-match @electron @persistence manual correction preserves an existing SQLite favorite', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120_000);
    await resetMockServers(request, ['xtream']);
    // This scenario uses a fictional catalog and generated local artwork.
    const credentials = { username: 'marketing', password: 'marketing' };
    const fixture = await fetchXtreamVodFixture(request, {
        ...credentials,
    });
    const movie = fixture.items[0];
    const title = getXtreamTitle(movie);
    const response = await request.get(`${xtreamMockServer}/player_api.php`, {
        params: {
            ...credentials,
            action: 'get_vod_info',
            vod_id: String(movie.stream_id),
        },
    });
    const provider = (await response.json()).info;
    const providerId = Number(provider.tmdb_id);
    expect(providerId).toBeGreaterThan(0);
    const selectedId = 900202;
    expect(providerId).not.toBe(selectedId);
    const manualPlot = 'Synthetic manually selected movie description.';
    const app = await launchElectronApp(dataDir);
    try {
        const page = app.mainWindow;
        await page.route('https://api.themoviedb.org/**', (route) => {
            const path = new URL(route.request().url()).pathname;
            return route.fulfill({
                json: path.includes('/search/')
                    ? {
                          results: [
                              { id: selectedId, title, original_title: title },
                          ],
                      }
                    : {
                          id: Number(path.split('/').pop()),
                          title,
                          original_title: title,
                          release_date: provider.releasedate,
                          overview: path.endsWith(`/${selectedId}`)
                              ? manualPlot
                              : 'Synthetic automatic movie description.',
                          credits: { cast: [], crew: [] },
                      },
            });
        });
        await openSettings(page);
        await openSettingsSection(page, 'tmdb');
        await setSwitch(
            page.getByTestId('tmdb-enabled').getByRole('switch'),
            true
        );
        await page.getByTestId('tmdb-api-key').fill('fictional-e2e-key');
        await saveSettings(page);
        await goToDashboard(page);
        await addXtreamPortal(page, credentials);
        await waitForXtreamWorkspaceReady(page);
        await page.getByRole('link', { name: 'Movies', exact: true }).click();
        await clickCategoryByNameExact(page, fixture.categoryName);
        await clickGridListCardByTitle(page, title);
        await expect(page.locator('app-content-hero')).toContainText(
            'Synthetic automatic movie description.'
        );
        const add = page.getByRole('button', {
            name: 'Add to favorites',
            exact: true,
        });
        const remove = page.getByRole('button', {
            name: 'Remove from favorites',
            exact: true,
        });
        await add.click();
        await expect(remove).toBeVisible();
        await page.locator('[data-testid="vod-more-menu"]').click();
        await page.getByTestId('tmdb-match-menu').click();
        const dialog = page.getByRole('dialog');
        await dialog
            .locator(`[data-testid="tmdb-match-result-${selectedId}"]`)
            .click();
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(page.locator('app-content-hero')).toContainText(
            manualPlot
        );
        await expect(remove).toBeVisible();
        await page.getByTestId('workspace-header-back').click();
        await clickGridListCardByTitle(page, title);
        await expect(page.locator('app-content-hero')).toContainText(
            manualPlot
        );
        await expect(remove).toBeVisible();
        await remove.click();
        await expect(add).toBeVisible();
        await add.click();
        await expect(remove).toBeVisible();
    } finally {
        await closeElectronApp(app);
    }
});
