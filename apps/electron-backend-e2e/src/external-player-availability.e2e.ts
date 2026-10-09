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

test('@settings @electron unavailable players stay disabled with editable paths', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
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
        await expect(page.locator('#mpvPlayerPath')).toBeEditable();
        await expect(page.locator('#vlcPlayerPath')).toBeEditable();
        await page.getByTestId('select-video-player').click();
        await expect(page.getByTestId('mpv')).toBeDisabled();
        await expect(page.getByTestId('vlc')).toBeDisabled();
        await expect(page.getByTestId('videojs')).toBeEnabled();
        await page.keyboard.press('Escape');
        await page.locator('#mpvPlayerPath').fill('custom-mpv-path');
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
