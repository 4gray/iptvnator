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

/**
 * A title re-matched on TMDB in its detail view shows the chosen match on
 * the dashboard hero too, not the automatic one.
 */
test('@tmdb-match @electron @dashboard the hero shows the TMDB match chosen in the detail view', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120_000);
    await resetMockServers(request, ['xtream']);
    // A fictional catalog with generated local artwork.
    const credentials = { username: 'marketing', password: 'marketing' };
    const fixture = await fetchXtreamVodFixture(request, credentials);
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
    const selectedId = 900303;
    expect(Number(provider.tmdb_id)).not.toBe(selectedId);
    const manualPlot = 'Synthetic plot of the hand-picked match.';
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
                              : 'Synthetic plot of the automatic match.',
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
            'Synthetic plot of the automatic match.'
        );
        // Favorited, so the title is one of the hero's slides.
        await page
            .getByRole('button', { name: 'Add to favorites', exact: true })
            .click();
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

        await goToDashboard(page);
        const hero = page.getByTestId('dashboard-hero');
        await expect(hero).toBeVisible();
        await expect(hero.getByText(manualPlot).first()).toBeAttached({
            timeout: 20_000,
        });
        await expect(
            hero.getByText('Synthetic plot of the automatic match.')
        ).toHaveCount(0);
    } finally {
        await closeElectronApp(app);
    }
});
