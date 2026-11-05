import { writeFile } from 'node:fs/promises';
import type { BrowserWindow } from 'electron';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickGridListCardByTitle,
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    launchElectronApp,
    goToDashboard,
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

for (const upgradeFails of [false, true]) {
    test(`@metadata @electron @persistence age rating ${upgradeFails ? 'preserves fresh legacy metadata when offline' : 'upgrades a legacy SQLite payload in place'}`, async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const fixture = await fetchXtreamVodFixture(request, {
            username: defaultXtreamUsername,
            password: defaultXtreamPassword,
        });
        const movie = fixture.items[0];
        const title = getXtreamTitle(movie);
        const response = await request.get(
            `${xtreamMockServer}/player_api.php?username=${defaultXtreamUsername}&password=${defaultXtreamPassword}&action=get_vod_info&vod_id=${movie.stream_id}`
        );
        const info = (await response.json()).info;
        const tmdbId = Number(info.tmdb_id);
        expect(tmdbId).toBeGreaterThan(0);
        const lookupKey = `id:${tmdbId}|v2`;
        const overview =
            'A fictional cached overview retained through classification upgrades.';
        const legacy = {
            id: tmdbId,
            title: info.name,
            release_date: info.releasedate,
            original_language: 'en',
            overview,
            credits: { cast: [], crew: [] },
            videos: { results: [] },
        };
        const app = await launchElectronApp(dataDir);
        try {
            const page = app.mainWindow;
            let detailsRequests = 0;
            await page.route('https://api.themoviedb.org/**', async (route) => {
                if (
                    new URL(route.request().url()).pathname.endsWith(
                        `/movie/${tmdbId}`
                    )
                ) {
                    detailsRequests++;
                    if (upgradeFails) return route.abort();
                    return route.fulfill({
                        json: {
                            ...legacy,
                            release_dates: {
                                results: [
                                    {
                                        iso_3166_1: 'DE',
                                        release_dates: [
                                            { certification: '12', type: 4 },
                                        ],
                                    },
                                ],
                            },
                        },
                    });
                }
                return route.fulfill({ json: {} });
            });
            await openSettings(page);
            await openSettingsSection(page, 'tmdb');
            await setSwitch(
                page.getByTestId('tmdb-enabled').getByRole('switch'),
                true
            );
            await page.getByTestId('tmdb-api-key').fill('fictional-e2e-key');
            await page.getByTestId('age-rating-country').click();
            await page
                .getByRole('option', { name: 'Germany (DE)', exact: true })
                .click();
            await saveSettings(page);
            await page.evaluate(
                async ({ lookupKey, tmdbId, legacy }) => {
                    await window.electron.dbSetTmdbMetadata({
                        mediaType: 'movie',
                        lookupKey,
                        language: 'en-US',
                        tmdbId,
                        payload: JSON.stringify(legacy),
                        fetchedAt: new Date().toISOString(),
                    });
                },
                { lookupKey, tmdbId, legacy }
            );
            const before = await page.evaluate(
                (key) =>
                    window.electron.dbGetTmdbMetadata('movie', key, 'en-US'),
                lookupKey
            );
            await goToDashboard(page);
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await page
                .getByRole('link', { name: 'Movies', exact: true })
                .click();
            await clickCategoryByNameExact(page, fixture.categoryName);
            await clickGridListCardByTitle(page, title);
            await expect(page.locator('app-content-hero')).toContainText(
                overview
            );
            const chip = page.locator(
                'app-age-rating-chip:visible [data-test-id="age-rating-chip"]'
            );
            await expect(chip).toHaveText(
                upgradeFails ? 'PG-13 · US' : '12 · DE'
            );
            await expect.poll(() => detailsRequests).toBe(1);
            const after = await page.evaluate(
                (key) =>
                    window.electron.dbGetTmdbMetadata('movie', key, 'en-US'),
                lookupKey
            );
            expect(after?.lookupKey).toBe(lookupKey);
            const payload = JSON.parse(after?.payload || '{}');
            if (upgradeFails) {
                expect(payload.release_dates).toBeUndefined();
                expect(after?.fetchedAt).toBe(before?.fetchedAt);
                expect(payload.overview).toBe(overview);
                expect(after?.payload).toBe(before?.payload);
                await page.getByTestId('workspace-header-back').click();
                await clickGridListCardByTitle(page, title);
                await expect(page.locator('app-content-hero')).toContainText(
                    overview
                );
                await expect(chip).toHaveText('PG-13 · US');
                expect(detailsRequests).toBe(1);
            } else {
                expect(payload.release_dates.results[0].iso_3166_1).toBe('DE');
                // Electron's file renderer cannot reload a routed file URL.
                // Reopen through the supported in-app route and read SQLite again.
                await page.getByTestId('workspace-header-back').click();
                await clickGridListCardByTitle(page, title);
                await expect(chip).toHaveText('12 · DE');
                expect(detailsRequests).toBe(1);
                const nativeWindow = await app.electronApp.browserWindow(page);
                try {
                    await nativeWindow.evaluate((window: BrowserWindow) =>
                        window.webContents.setZoomFactor(2)
                    );
                    await expect
                        .poll(() =>
                            nativeWindow.evaluate((window: BrowserWindow) =>
                                window.webContents.getZoomFactor()
                            )
                        )
                        .toBe(2);
                    const drawerClose = page.locator(
                        '.drawer-open [data-test-id="context-drawer-close"]'
                    );
                    if (await drawerClose.count()) await drawerClose.click();
                    await expect(
                        page.locator('mat-snack-bar-container')
                    ).toHaveCount(0);
                    await chip.evaluate((element) =>
                        element.scrollIntoView({
                            block: 'center',
                            inline: 'nearest',
                        })
                    );
                    await expect(chip).toBeVisible();
                    await expect(chip).toBeInViewport();
                    const classification = chip.getByRole('button');
                    await classification.click({ trial: true });
                    await classification.focus();
                    await classification.press('Shift+Tab');
                    await page.keyboard.press('Tab');
                    await expect(classification).toBeFocused();
                    // Capture Electron's native viewport at the actual zoom factor.
                    const png = await nativeWindow.evaluate(
                        async (window: BrowserWindow) => {
                            const image =
                                await window.webContents.capturePage();
                            return image.toPNG().toString('base64');
                        }
                    );
                    await writeFile(
                        test
                            .info()
                            .outputPath('age-rating-electron-zoom200.png'),
                        Buffer.from(png, 'base64')
                    );
                } finally {
                    await nativeWindow.evaluate((window: BrowserWindow) =>
                        window.webContents.setZoomFactor(1)
                    );
                    await nativeWindow.dispose();
                }
            }
            await page.screenshot({
                path: test
                    .info()
                    .outputPath(
                        `age-rating-electron-${upgradeFails ? 'legacy-offline' : 'upgraded'}.png`
                    ),
            });
        } finally {
            await closeElectronApp(app);
        }
    });
}
