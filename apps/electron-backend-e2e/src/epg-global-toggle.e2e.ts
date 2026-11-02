import { createServer } from 'node:http';
import {
    buildM3uContent,
    channelItemByTitle,
    closeElectronApp,
    createMutableTextServer,
    expect,
    goToDashboard,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openSources,
    openSettings,
    openSettingsSection,
    saveSettings,
    setSwitch,
    test,
} from './electron-test-fixtures';
import {
    expectRendererReloadedOnRoute,
    reloadFromMainProcess,
} from './renderer-reload.support';

test('@epg @electron global opt-out ignores declared XMLTV and preserves playlist logos across restart', async ({
    dataDir,
}) => {
    let guideRequests = 0;
    const guide = createServer((_request, response) => {
        guideRequests++;
        response.writeHead(200, { 'Content-Type': 'application/xml' });
        response.end(
            '<?xml version="1.0"?><tv><channel id="toggle-news"><display-name>Toggle News</display-name></channel></tv>'
        );
    });
    await new Promise<void>((resolve) => guide.listen(0, '127.0.0.1', resolve));
    const address = guide.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing fixture port');
    const epgUrl = `http://127.0.0.1:${address.port}/guide.xml`;
    const logo =
        'data:image/svg+xml;base64,' +
        Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="navy"/></svg>'
        ).toString('base64');
    const playlist = await createMutableTextServer(
        buildM3uContent([
            {
                name: 'Toggle News',
                tvgId: 'toggle-news',
                logo,
                url: 'https://example.org/toggle-news.m3u8',
            },
        ]).replace('#EXTM3U', `#EXTM3U x-tvg-url="${epgUrl}"`)
    );
    let app = await launchElectronApp(dataDir);
    try {
        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'epg');
        const toggle = () =>
            app.mainWindow
                .getByTestId('toggle-epg-enabled')
                .getByRole('switch');
        await expect(toggle()).toBeChecked();
        await setSwitch(toggle(), false);
        await saveSettings(app.mainWindow);
        await goToDashboard(app.mainWindow);
        await importM3uPlaylistFromUrl(app.mainWindow, playlist.resourceUrl);
        const channel = () => channelItemByTitle(app.mainWindow, 'Toggle News');
        await expect(channel()).toHaveClass(/compact/);
        await expect(channel().locator('.channel-logo')).toHaveAttribute(
            'src',
            logo
        );
        await channel().click();
        await expect(
            app.mainWindow.locator(
                'app-epg-timeline, app-epg-list-view, app-epg-guide'
            )
        ).toHaveCount(0);
        expect(guideRequests).toBe(0);
        await closeElectronApp(app);
        app = await launchElectronApp(dataDir);
        await openSources(app.mainWindow);
        await app.mainWindow
            .locator('app-source-row .source-row__body')
            .first()
            .click();
        await expect(channel()).toHaveClass(/compact/);
        await expect(channel().locator('.channel-logo')).toHaveAttribute(
            'src',
            logo
        );
        expect(guideRequests).toBe(0);
        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'epg');
        await expect(toggle()).not.toBeChecked();
        await setSwitch(toggle(), true);
        await saveSettings(app.mainWindow);
        await openSources(app.mainWindow);
        await app.mainWindow
            .locator('app-source-row .source-row__body')
            .first()
            .click();
        await expect.poll(() => guideRequests).toBeGreaterThan(0);
        await expect(channel().locator('.channel-logo')).toHaveAttribute(
            'src',
            logo
        );
        // A fresh renderer must restore its saved preference even when the
        // existing main-process worker was left suspended by the prior one.
        await app.mainWindow.evaluate(async () => {
            const setEnabled = window.electron.setEpgEnabled;
            if (!setEnabled) throw new Error('Missing EPG preference bridge');
            await setEnabled(false);
        });
        const beforeResume = guideRequests;
        await reloadFromMainProcess(app);
        await expectRendererReloadedOnRoute(app.mainWindow, /\/workspace/);
        await expect(channel()).toBeVisible();
        await expect(channel()).not.toHaveClass(/compact/);
        await app.mainWindow.evaluate(
            (url) => window.electron.forceFetchEpg(url),
            epgUrl
        );
        await expect.poll(() => guideRequests).toBeGreaterThan(beforeResume);
    } finally {
        await closeElectronApp(app);
        await playlist.close();
        await new Promise<void>((resolve, reject) =>
            guide.close((error) => (error ? reject(error) : resolve()))
        );
    }
});
