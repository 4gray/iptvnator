import { writeFileSync } from 'node:fs';
import {
    addStalkerPortal,
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openGlobalFavorites,
    openSettings,
    openSettingsSection,
    saveSettings,
    test,
    waitForM3uCatalog,
    waitForXtreamWorkspaceReady,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';
import { startAccessibilityFixture } from './accessibility-followup.fixture';
import { applyTheme, expectTextContrast } from './theme-contrast';

let fixture: Awaited<ReturnType<typeof startAccessibilityFixture>>;
test.beforeAll(async () => {
    fixture = await startAccessibilityFixture();
});
test.afterAll(async () => {
    await fixture.close();
});

test('@electron @a11y Settings text meets contrast in every preset', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await openSettings(page);
        await openSettingsSection(page, 'appearance');
        for (const theme of [
            'light',
            'dark',
            'cream',
            'mocha',
            'night-owl',
            'black-oled',
        ] as const) {
            await page
                .getByTestId('select-theme')
                .getByTestId(`${theme.replace(/-/g, '_').toUpperCase()}_THEME`)
                .click();
            await expect(page.locator('body')).toHaveAttribute(
                'data-app-theme',
                theme
            );
            await expectTextContrast(
                page.locator('.settings-section-item.active .nav-item-label')
            );
            const paletteLabels = page
                .getByTestId('select-theme')
                .locator('.theme-palette__label');
            await expect(paletteLabels).toHaveCount(7);
            for (const label of await paletteLabels.all()) {
                await expectTextContrast(label);
            }
            const coverOptions = page
                .getByTestId('select-cover-size')
                .locator('.theme-switcher__option');
            await expect(coverOptions).toHaveCount(3);
            for (const option of await coverOptions.all()) {
                await expectTextContrast(option);
            }
        }
    } finally {
        await closeElectronApp(app);
    }
});

test('@electron @a11y compact player settings remain reachable at genuine 200% zoom', async ({
    dataDir,
}) => {
    const file = writeTemporaryM3uFile(dataDir, 'synthetic-a11y.m3u', [
        {
            name: 'Synthetic Clip',
            groupTitle: 'Synthetic Group',
            url: `${fixture.url}/clip.webm`,
        },
    ]);
    const app = await launchElectronApp(dataDir, { appArgs: [file] });
    const page = app.mainWindow;
    try {
        await waitForM3uCatalog(page);
        await openSettings(page);
        await openSettingsSection(page, 'playback');
        await page.getByTestId('select-video-player').click();
        await page
            .getByRole('option', { name: 'HTML5 video player', exact: true })
            .click();
        await saveSettings(page);
        await page.keyboard.press('Escape');
        await page.locator('button.channel-content').first().click();
        const video = page.locator('app-web-player-view video');
        await expect
            .poll(() =>
                video.evaluate((el: HTMLVideoElement) => el.duration > 5)
            )
            .toBe(true);
        await video.evaluate((el: HTMLVideoElement) => el.pause());
        for (const height of [800, 600]) {
            await app.electronApp.evaluate(({ BrowserWindow }, height) => {
                const win = BrowserWindow.getAllWindows()[0];
                win.setContentSize(1280, height);
            }, height);
            // Chromium zoom, not CDP page-scale emulation; reapply after each resize.
            await app.electronApp.evaluate(({ BrowserWindow }) => {
                BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2);
            });
            await expect.poll(() => page.evaluate(() => innerWidth)).toBe(640);
            for (const theme of ['light', 'dark'] as const) {
                await applyTheme(page, theme);
                const opener = page.getByTestId(
                    'player-controls-settings-button'
                );
                await opener.focus();
                await page.keyboard.press('Enter');
                const sheet = page.locator('app-player-settings-panel');
                await expect(sheet).toHaveClass(/player-settings--sheet/);
                await expect
                    .poll(() =>
                        sheet
                            .locator('.player-settings__body')
                            .evaluate((el) => el.clientHeight)
                    )
                    .toBeGreaterThan(0);
                const speed = sheet.getByRole('radio', {
                    name: '2×',
                    exact: true,
                });
                await speed.focus();
                await expect(speed).toBeFocused();
                await expect
                    .poll(() =>
                        speed.evaluate((el) => {
                            const box = el.getBoundingClientRect();
                            return el.contains(
                                document.elementFromPoint(
                                    box.x + box.width / 2,
                                    box.y + box.height / 2
                                )
                            );
                        })
                    )
                    .toBe(true);
                await expect(speed).toBeInViewport({ ratio: 1 });
                // capturePage includes the complete native window at Chromium zoom.
                const capture = await app.electronApp.evaluate(
                    async ({ BrowserWindow }) =>
                        (
                            await BrowserWindow.getAllWindows()[0].webContents.capturePage()
                        )
                            .toPNG()
                            .toString('base64')
                );
                writeFileSync(
                    test.info().outputPath(`player-200-${height}-${theme}.png`),
                    Buffer.from(capture, 'base64')
                );
                await page.keyboard.press('Space');
                await expect
                    .poll(() =>
                        video.evaluate(
                            (el: HTMLVideoElement) => el.playbackRate
                        )
                    )
                    .toBe(2);
                await page.keyboard.press('Escape');
                await expect(sheet).toHaveCount(0);
                await expect(opener).toBeFocused();
            }
        }
    } finally {
        await closeElectronApp(app);
    }
});

test('@electron @a11y catalog search announces counts and deep detail returns focus; seasons use one Tab stop', async ({
    dataDir,
}) => {
    test.setTimeout(120_000);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await addXtreamPortal(page, {
            serverUrl: fixture.url,
            name: 'Synthetic Accessibility Source',
            username: 'synthetic-a',
            password: 'synthetic-only',
        });
        await waitForXtreamWorkspaceReady(page);
        const status = page.locator(
            'app-category-content-view [role="status"]'
        );
        await expect(status).toContainText('320');
        await expect(status).toHaveAttribute('aria-atomic', 'true');
        const search = page.locator(
            'app-workspace-shell-header input[type="search"]'
        );
        await search.fill('synthetic-no-match');
        await expect(status).toContainText('0');
        await expect(search).toBeFocused();
        await search.fill('');
        await expect(status).toContainText('320');
        const grid = page.locator('app-grid-list');
        await grid.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
        });
        // Infinite append can change .last() between keyboard and attribute reads.
        const key = await grid
            .locator('mat-card')
            .last()
            .getAttribute('data-catalog-focus-key');
        const card = grid.locator(`[data-catalog-focus-key="${key}"]`);
        await card.focus();
        const offset = await grid.evaluate((el) => el.scrollTop);
        expect(offset).toBeGreaterThan(0);
        await page.keyboard.press('Enter');
        await expect(page.locator('app-portal-detail-shell h1')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(
            grid.locator(`[data-catalog-focus-key="${key}"]`)
        ).toBeFocused();
        await expect
            .poll(() => grid.evaluate((el) => el.scrollTop))
            .toBeGreaterThan(offset - 2);
        await card.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('app-portal-detail-shell h1')).toBeVisible();
        await page.getByTestId('workspace-header-back').focus();
        await page.keyboard.press('Enter');
        await expect(card).toBeFocused();
        await page.getByRole('link', { name: 'Series', exact: true }).click();
        await grid.locator('mat-card').first().click();
        const tabs = page.locator('app-season-tabs [role="tab"]');
        await expect(tabs).toHaveCount(3);
        await tabs.first().focus();
        await page.keyboard.press('End');
        await expect(tabs.last()).toBeFocused();
        await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
        await expect(
            page.locator('app-season-tabs [role="tab"][tabindex="0"]')
        ).toHaveCount(1);
        const panelId = await tabs.last().getAttribute('aria-controls');
        await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute(
            'role',
            'tabpanel'
        );
        await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute(
            'aria-labelledby',
            (await tabs.last().getAttribute('id')) as string
        );
        await page.screenshot({
            path: test.info().outputPath('synthetic-season-tabs.png'),
        });
        await page.keyboard.press('ArrowRight');
        await expect(tabs.first()).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(tabs.first()).not.toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(tabs.first()).toBeFocused();
    } finally {
        await closeElectronApp(app);
    }
});

test('@electron @a11y removing focused favorite rows keeps focus in the list', async ({
    dataDir,
}) => {
    const file = writeTemporaryM3uFile(
        dataDir,
        'synthetic-favorites.m3u',
        [1, 2].map((id) => ({
            name: `Synthetic Channel ${id}`,
            groupTitle: 'Synthetic Group',
            url: `${fixture.url}/clip.webm?id=${id}`,
        }))
    );
    const app = await launchElectronApp(dataDir, { appArgs: [file] });
    const page = app.mainWindow;
    try {
        await waitForM3uCatalog(page);
        const stars = page.locator('app-channel-list-item .favorite-button');
        await stars.nth(0).click();
        await stars.nth(1).click();
        await openGlobalFavorites(page);
        const pane = page.locator(
            'app-global-favorites-list [appChannelScrollFocus]'
        );
        const rows = pane.locator('app-channel-list-item');
        await expect(rows).toHaveCount(2);
        await rows.first().locator('.favorite-button').focus();
        await page.keyboard.press('Space');
        await expect(rows).toHaveCount(1);
        await expect(
            rows.first().locator('button.channel-content')
        ).toBeFocused();
        await rows.first().locator('.favorite-button').focus();
        await page.keyboard.press('Space');
        await expect(rows).toHaveCount(0);
        await expect(page.locator('main')).toBeFocused();
    } finally {
        await closeElectronApp(app);
    }
});

test('@electron @a11y Stalker inline detail restores its card and shares season keyboard behavior', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        // This account is the mock's fictional, locally illustrated catalog.
        await addStalkerPortal(page, {
            name: 'Synthetic Stalker Source',
            macAddress: '00:1A:79:00:00:07',
        });
        await page.getByRole('link', { name: 'Movies', exact: true }).click();
        await page.locator('.category-item').first().click();
        const grid = page.locator('app-grid-list');
        await expect(grid.locator('mat-card').first()).toBeVisible();
        const key = await grid
            .locator('mat-card')
            .first()
            .getAttribute('data-catalog-focus-key');
        const card = grid.locator(`[data-catalog-focus-key="${key}"]`);
        await card.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('app-portal-detail-shell h1')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(card).toBeFocused();
        await card.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('app-portal-detail-shell h1')).toBeVisible();
        await page.getByTestId('workspace-header-back').focus();
        await page.keyboard.press('Enter');
        await expect(card).toBeFocused();
        await page.getByRole('link', { name: 'Series', exact: true }).click();
        await page.locator('.category-item').first().click();
        await grid.locator('mat-card').first().click();
        const tabs = page.locator('app-season-tabs [role="tab"]');
        await expect(tabs).toHaveCount(2);
        await tabs.first().focus();
        await page.keyboard.press('End');
        await expect(tabs.last()).toBeFocused();
        await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(tabs.last()).toBeFocused();
    } finally {
        await closeElectronApp(app);
    }
});
