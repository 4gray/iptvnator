import {
    addStalkerPortal,
    addXtreamPortal,
    clickCategoryById,
    clickGridListCardByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    saveSettings,
    setSwitch,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    fetchStalkerCategoryFixture,
    fetchXtreamVodFixture,
    getStalkerTitle,
    getXtreamTitle,
} from './portal-mock-fixtures';
import { applyTheme } from './theme-contrast';

test('@stalker @electron shows current-portal and Xtream recommendations together', async ({
    dataDir,
    request,
}, testInfo) => {
    const stalker = await fetchStalkerCategoryFixture(request, 'vod');
    const credentials = { username: 'marketing', password: 'marketing' };
    const xtream = await fetchXtreamVodFixture(request, credentials);
    const title = getStalkerTitle(stalker.items[0]);
    const localTitles = stalker.items.slice(1, 3).map(getStalkerTitle);
    const crossPortalTitle = getXtreamTitle(xtream.items[0]);
    const date = (stalker.items[0] as { year?: string }).year;
    const movie = {
        id: 92001,
        title,
        original_title: title,
        ...(date ? { release_date: `${date}-01-01` } : {}),
        original_language: 'en',
        overview: 'Fictional movie metadata.',
    };

    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await page.route('https://api.themoviedb.org/**', (route) => {
            const url = new URL(route.request().url());
            return route.fulfill({
                json: url.pathname.includes('/search/')
                    ? { results: [movie] }
                    : {
                          ...movie,
                          recommendations: {
                              results: [...localTitles, crossPortalTitle].map(
                                  (title, index) => ({
                                      id: 92002 + index,
                                      title,
                                  })
                              ),
                          },
                      },
            });
        });
        await addXtreamPortal(page, credentials);
        await waitForXtreamWorkspaceReady(page);
        await openSettings(page);
        await openSettingsSection(page, 'tmdb');
        await setSwitch(
            page.getByTestId('tmdb-enabled').getByRole('switch'),
            true
        );
        await page.getByTestId('tmdb-api-key').fill('fictional-e2e-key');
        await saveSettings(page);
        await goToDashboard(page);
        await addStalkerPortal(page, { name: 'Fictional Stalker Portal' });
        await page.waitForURL(/\/stalker\/.*\/vod/);
        await clickCategoryById(page, stalker.categoryId);
        await clickGridListCardByTitle(page, title);

        const rail = page.getByTestId('tmdb-similar');
        const cards = rail.locator('.similar-card');
        await expect(cards.locator('.similar-card__title')).toHaveText([
            ...localTitles,
            crossPortalTitle,
        ]);
        await expect(
            page.getByText('Success! Configuration was saved.')
        ).toBeHidden();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await rail.scrollIntoViewIfNeeded();
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            await page.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(`stalker-similar-${theme}.png`),
            });
        }
        await page.setViewportSize({ width: 375, height: 800 });
        const next = rail.getByRole('button', { name: 'Next', exact: true });
        await expect(next).toBeVisible();
        await next.focus();
        await page.keyboard.press('Tab');
        await expect(cards.first()).toBeFocused();
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('stalker-similar-narrow.png'),
        });
        await page.keyboard.press('Enter');
        await expect(
            page.getByRole('heading', { name: localTitles[0], exact: true })
        ).toBeVisible();
        await page.getByTestId('workspace-header-back').click();
        await expect(
            page.getByRole('heading', { name: title, exact: true })
        ).toBeVisible();

        await cards.last().click();
        await expect(page).toHaveURL(/\/xtreams\/.*\/vod\//);
        await expect(
            page.getByRole('heading', { name: crossPortalTitle, exact: true })
        ).toBeVisible();
        await page.getByTestId('workspace-header-back').click();
        await expect(
            page.getByRole('heading', { name: title, exact: true })
        ).toBeVisible();
    } finally {
        await closeElectronApp(app);
    }
});
