import {
    addXtreamPortal,
    addStalkerPortal,
    waitForStalkerCatalog,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    openWorkspaceSection,
    openSettings,
    openSettingsSection,
    saveSettings,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import {
    fetchXtreamEpgFixture,
    fetchStalkerCategoryFixture,
} from './portal-mock-fixtures';

import {
    applyTheme,
    expectTextContrast,
    expectThemeSurface,
    expectSkeletonContrast,
} from './theme-contrast';

const epgCredentials = {
    username: 'epg',
    password: 'epg',
};

test('@epg @xtream @electron opens the programme dialog from a timeline block and reacts to zoom', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamEpgFixture(request, epgCredentials);
    const currentProgram = fixture.shortEpg[0];
    if (!currentProgram) {
        throw new Error(
            'Expected the Xtream EPG fixture to include a current program.'
        );
    }
    const app = await launchElectronApp(dataDir, { env: { TZ: 'UTC' } });

    try {
        await app.electronApp.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].setSize(1800, 1000);
        });
        // No external demo stream is needed for guide interaction/contrast.
        await app.mainWindow.route('https://test-streams.mux.dev/**', () => {
            // Keep the external demo request pending; guide data is local.
        });
        await addXtreamPortal(app.mainWindow, {
            name: 'Xtream Timeline Interaction',
            username: epgCredentials.username,
            password: epgCredentials.password,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);

        const channelRow = channelItemByTitle(
            app.mainWindow,
            fixture.stream.name ?? ''
        ).first();
        await expect(channelRow).toBeVisible({ timeout: 20000 });
        await channelRow.click();

        const timeline = app.mainWindow.locator('app-epg-timeline');
        await expect(timeline).toBeVisible({ timeout: 20000 });

        const nowBlock = timeline
            .locator('.epg-timeline__block.is-now')
            .first();
        await expect(nowBlock).toBeVisible();

        // Zooming re-renders the ribbon: block widths grow with px/minute.
        const zoomInput = timeline.locator(
            '.epg-timeline__zoom input[type="range"]'
        );
        await expect(zoomInput).toBeVisible();

        const blockWidthAt = async (zoom: 'min' | 'max') => {
            await zoomInput.evaluate((element, target) => {
                const input = element as HTMLInputElement;
                input.value = target === 'min' ? input.min : input.max;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }, zoom);
            const box = await nowBlock.boundingBox();
            return box?.width ?? 0;
        };

        const minZoomWidth = await blockWidthAt('min');
        const maxZoomWidth = await blockWidthAt('max');
        expect(maxZoomWidth).toBeGreaterThan(minZoomWidth);

        for (const theme of ['light', 'dark', 'light'] as const) {
            await applyTheme(app.mainWindow, theme);
            await expectThemeSurface(timeline, theme);
            await expectTextContrast(
                timeline.locator('.epg-timeline__heading b')
            );
            await expectTextContrast(
                nowBlock.locator('.epg-timeline__block-title')
            );
            await expectTextContrast(
                nowBlock.locator('.epg-timeline__block-time')
            );
            // Exercise the worst-case overlapping current/playing tints,
            // including the sibling progress fill behind the small live label.
            for (const playing of [false, true]) {
                await nowBlock.evaluate((element, active) => {
                    element.classList.toggle('is-playing', active);
                }, playing);
                await expectTextContrast(
                    nowBlock.locator('.epg-timeline__tag.is-now'),
                    4.5,
                    '.epg-timeline__fill--live'
                );
            }
            await nowBlock.evaluate((element) =>
                element.classList.remove('is-playing')
            );
            await nowBlock.hover();
            await expectTextContrast(
                nowBlock.locator('.epg-timeline__info'),
                3
            );
        }

        // At max zoom the on-air block is wide enough to expose the info
        // affordance (hidden on narrow/micro tiers), which opens the shared
        // programme-details dialog with the programme metadata.
        await nowBlock.locator('.epg-timeline__info').click();

        const dialog = app.mainWindow.locator('.epg-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.epg-dialog__title')).toHaveText(
            currentProgram.title
        );
        // An on-air programme offers "watch live" as the primary action.
        await expect(dialog.locator('.epg-dialog__btn--primary')).toBeVisible();

        for (const theme of ['light', 'dark', 'light'] as const) {
            await applyTheme(app.mainWindow, theme);
            await expectThemeSurface(dialog, theme);
            await expectTextContrast(dialog.locator('.epg-dialog__title'));
            await expectTextContrast(dialog.locator('.epg-dialog__desc'));
            await expectTextContrast(dialog.locator('.epg-dialog__close'), 3);
        }
        await app.mainWindow.screenshot({
            path: test.info().outputPath('epg-light.png'),
        });
        await dialog.locator('.epg-dialog__close').click();
        await app.mainWindow.waitForSelector('.epg-dialog', {
            state: 'detached',
        });
        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'epg');
        await app.mainWindow.getByTestId('epg-view-mode-list').click();
        await saveSettings(app.mainWindow);
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        await channelItemByTitle(app.mainWindow, fixture.stream.name ?? '')
            .first()
            .click();
        const guide = app.mainWindow.locator('app-epg-list-view');
        await expect(guide).toBeVisible();
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(app.mainWindow, theme);
            await expectThemeSurface(guide, theme);
            await expectTextContrast(
                guide.locator('[data-when="now"] .time').first()
            );
            await expectTextContrast(
                guide.locator('[data-when="now"] .title').first()
            );
            await expectTextContrast(
                guide.locator('[data-when="now"] .desc').first()
            );
        }
        // Keep a fresh channel's EPG IPC pending so the real list loading
        // template stays mounted through both theme changes.
        await app.electronApp.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('XTREAM_REQUEST');
            ipcMain.handle(
                'XTREAM_REQUEST',
                () =>
                    new Promise(() => {
                        // Released when this isolated Electron test app closes.
                    })
            );
        });
        await app.mainWindow
            .locator('[data-test-id="channel-item"]')
            .nth(1)
            .click();
        const skeleton = guide.locator('.sk-time').first();
        await expect(skeleton).toBeVisible();
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(app.mainWindow, theme);
            await expectSkeletonContrast(skeleton, guide);
            await expectSkeletonContrast(
                guide.locator('.sk-title').first(),
                guide
            );
        }
    } finally {
        await closeElectronApp(app);
    }
});

test('@epg @stalker @theme @electron applies live themes to the shared Stalker guide', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['stalker']);
    const fixture = await fetchStalkerCategoryFixture(request, 'itv');
    const item = fixture.items[0];
    const app = await launchElectronApp(dataDir);
    try {
        await app.electronApp.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].setSize(1800, 1000);
        });
        await app.mainWindow.route('https://test-streams.mux.dev/**', () => {
            // Keep the external demo request pending; guide data is local.
        });
        await addStalkerPortal(app.mainWindow, {
            name: 'Stalker Theme Fixture',
        });
        await waitForStalkerCatalog(app.mainWindow);
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        await channelItemByTitle(app.mainWindow, item.o_name || item.name || '')
            .first()
            .click();
        const timeline = app.mainWindow.locator('app-epg-timeline');
        await expect(timeline).toBeVisible();
        for (const theme of ['light', 'dark', 'light'] as const) {
            await applyTheme(app.mainWindow, theme);
            await expectThemeSurface(timeline, theme);
            await expectTextContrast(
                timeline.locator('.epg-timeline__heading b')
            );
            await app.mainWindow.screenshot({
                path: test.info().outputPath(`stalker-${theme}.png`),
            });
        }
    } finally {
        await closeElectronApp(app);
    }
});
