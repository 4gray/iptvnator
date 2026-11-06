import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    saveSettings,
    test,
} from './electron-test-fixtures';
import { mockExternalPlayerAvailability } from './external-player-availability.fixture';

test('@settings @electron missing players remain selectable with nearby path guidance', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        const executable = await app.electronApp.evaluate(
            () => process.execPath
        );
        await expect(
            page.evaluate(
                (file) =>
                    window.electron.getExternalPlayerAvailability?.({
                        mpv: file,
                        vlc: file,
                    }),
                executable
            )
        ).resolves.toEqual({ mpv: true, vlc: true });
        await expect(
            page.evaluate(() =>
                window.electron.getExternalPlayerAvailability?.({
                    mpv: '/iptvnator-e2e-missing-players/mpv',
                    vlc: '/iptvnator-e2e-missing-players/vlc',
                })
            )
        ).resolves.toEqual({ mpv: false, vlc: false });
        await mockExternalPlayerAvailability(app, { mpv: false, vlc: false });
        await openSettings(page);
        await openSettingsSection(page, 'playback');
        await expect(page.locator('#mpvPlayerPath')).toBeHidden();
        await expect(page.locator('#vlcPlayerPath')).toBeHidden();
        await expect(
            page.getByTestId('mpv-player-arguments-setting')
        ).toBeHidden();
        await expect(
            page.getByTestId('vlc-player-arguments-setting')
        ).toBeHidden();
        await page.getByTestId('select-video-player').click();
        await expect(page.getByTestId('mpv')).toBeEnabled();
        await expect(page.getByTestId('mpv')).toContainText('Not found');
        await expect(page.getByTestId('vlc')).toBeEnabled();
        await expect(page.getByTestId('videojs')).toBeEnabled();
        await page.getByTestId('mpv').click();
        await expect(page.locator('#mpvPlayerPath')).toBeEditable();
        await expect(page.locator('#vlcPlayerPath')).toBeHidden();
        await expect(page.getByTestId('external-player-status')).toContainText(
            'Player not found'
        );
        const selector = await page
            .getByTestId('select-video-player')
            .boundingBox();
        const path = await page.locator('#mpvPlayerPath').boundingBox();
        if (!path || !selector)
            throw new Error('Expected visible player and path controls');
        expect(path.y - selector.y).toBeLessThan(350);
        await page.locator('#mpvPlayerPath').fill('custom-mpv-path');
        await expect(page.locator('#mpvPlayerPath')).toHaveValue(
            'custom-mpv-path'
        );
        await mockExternalPlayerAvailability(app, { mpv: true, vlc: false });
        await expect(page.getByTestId('check-external-players')).toBeEnabled();
        await page.getByTestId('check-external-players').click();
        await expect(page.getByTestId('external-player-status')).toHaveText(
            'Player found'
        );
        await expect(page.locator('#mpvPlayerPath')).toHaveValue(
            'custom-mpv-path'
        );
        await saveSettings(page);
        await expect(page.getByTestId('unsaved-dialog-save')).toBeHidden();
    } finally {
        await closeElectronApp(app);
    }
});

test('@settings @electron unknown availability does not disable a player', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await mockExternalPlayerAvailability(app, { mpv: null, vlc: true });
        await openSettings(page);
        await openSettingsSection(page, 'playback');
        await page.getByTestId('select-video-player').click();
        await expect(page.getByTestId('mpv')).toBeEnabled();
        await expect(page.getByTestId('vlc')).toBeEnabled();
        await page.getByTestId('mpv').click();
        await expect(page.getByTestId('select-video-player')).toContainText(
            'MPV'
        );
        await page
            .locator('app-workspace-shell-rail a[href$="/workspace/dashboard"]')
            .first()
            .click({ noWaitAfter: true });
        await expect(page.getByTestId('unsaved-dialog-save')).toBeVisible();
        await saveSettings(page);
        await page.waitForURL(/\/workspace\/dashboard$/);
        await openSettings(page);
        await openSettingsSection(page, 'playback');
        await expect(page.getByTestId('select-video-player')).toContainText(
            'MPV'
        );
        await expect(page.getByTestId('save-settings')).toBeHidden();
    } finally {
        await closeElectronApp(app);
    }
});
