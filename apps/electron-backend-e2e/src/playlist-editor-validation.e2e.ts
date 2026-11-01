import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSourceEditor,
    openSources,
    resetMockServers,
    test,
    xtreamMockServer,
} from './electron-test-fixtures';
import { applyTheme, expectTextContrast } from './theme-contrast';

test('Xtream editor validates locally and preserves normalized credentials in Electron', async ({
    dataDir,
    request,
}, testInfo) => {
    await resetMockServers(request, ['xtream']);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await addXtreamPortal(page, { name: 'Validation fixture' });
        await openSources(page);
        let dialog = await openSourceEditor(page, 'Validation fixture');
        const agent = dialog.locator('[formControlName="userAgent"]');
        const resting = dialog.locator(
            'mat-form-field:has(input[formControlName="userAgent"]) mat-label'
        );
        const title = dialog.locator('[formControlName="title"]');
        const focused = dialog.locator(
            'mat-form-field:has(input[formControlName="title"]) mat-label'
        );
        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            await agent.fill('');
            await title.focus();
            await expectTextContrast(resting);
            await expectTextContrast(focused);
            await page.screenshot({
                path: testInfo.outputPath(`xtream-labels-${theme}.png`),
            });
        }
        await dialog.locator('[formControlName="serverUrl"]').fill('not-a-url');
        await dialog.locator('[formControlName="username"]').fill(' ');
        await dialog.locator('[formControlName="password"]').fill(' ');
        await title.focus();
        await expect(dialog.locator('mat-error')).toHaveCount(3);
        await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
        await expect(
            dialog.locator(
                'button[aria-describedby="xtream-edit-http-test-notice"]'
            )
        ).toBeDisabled();
        await page.setViewportSize({ width: 390, height: 500 });
        await dialog.locator('mat-error').last().scrollIntoViewIfNeeded();
        await page.screenshot({
            path: testInfo.outputPath('xtream-errors-phone.png'),
        });
        await dialog
            .locator('[formControlName="serverUrl"]')
            .fill(
                ` ${xtreamMockServer}/provider/player_api.php?username=ignored&password=ignored `
            );
        await dialog
            .locator('[formControlName="username"]')
            .fill(' validated-user ');
        await dialog
            .locator('[formControlName="password"]')
            .fill(' validated-password ');
        await dialog.locator('button[type="submit"]').click();
        await expect(dialog).toBeHidden();
        await expect
            .poll(() =>
                page.evaluate(
                    async () =>
                        (await window.electron.dbGetAppPlaylists()).find(
                            (p) => p.title === 'Validation fixture'
                        )?.serverUrl
                )
            )
            .toBe(`${xtreamMockServer}/provider`);
        await page.setViewportSize({ width: 1280, height: 720 });
        dialog = await openSourceEditor(page, 'Validation fixture');
        await expect(
            dialog.locator('[formControlName="username"]')
        ).toHaveValue('validated-user');
        await expect(
            dialog.locator('[formControlName="password"]')
        ).toHaveValue('validated-password');
        await expect(
            dialog.locator('[formControlName="serverUrl"]')
        ).toHaveValue(`${xtreamMockServer}/provider`);
    } finally {
        await closeElectronApp(app);
    }
});
