import {
    addStalkerPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    resetMockServers,
    stalkerMockServer,
    test,
    waitForStalkerCatalog,
} from './electron-test-fixtures';

/**
 * End-to-end proof that a BUILT-IN player's media requests carry the portal
 * credentials (mac cookie + Bearer token) — the root of the long-running
 * "only VLC works" cluster (#849, #910, #732): the web players used to
 * receive only User-Agent/Referer/Origin, so any stream gated on the portal
 * session could never play inline.
 *
 * The mock's `gated-stream` scenario makes `create_link` return this
 * server's own `/stream/gated/video.mp4`, which answers 403 unless the
 * request presents the mac cookie AND the MAC's current access token. A unit
 * test cannot show that a header reached the video element; playback
 * advancing past that gate can only happen when the scoped Electron header
 * override attached the credentials to the actual media request.
 */

const GATED_MAC = '00:1A:79:00:00:09';
const GATED_STREAM_URL = `${stalkerMockServer}/stream/gated/video.mp4`;
// The full-portal URL shape: the app handshakes and holds a Bearer token,
// which is exactly what the gated stream endpoint demands.
const FULL_PORTAL_URL = `${stalkerMockServer}/stalker_portal/server/load.php`;

test('@electron @stalker built-in player plays an auth-gated portal stream', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['stalker']);

    // First prove the gate is real: a credential-less request is refused, so
    // a green playback assertion below cannot be a permissive-mock artifact.
    const bareResponse = await request.get(GATED_STREAM_URL);
    expect(bareResponse.status()).toBe(403);

    const app = await launchElectronApp(dataDir);

    try {
        await addStalkerPortal(app.mainWindow, {
            macAddress: GATED_MAC,
            portalUrl: FULL_PORTAL_URL,
        });
        await waitForStalkerCatalog(app.mainWindow);

        // The portal lands on Movies; live playback lives in the ITV layout.
        await app.mainWindow
            .getByRole('link', { name: /live|itv/i })
            .click();
        await app.mainWindow.waitForURL(/stalker.*itv/);

        // The ITV view renders channels only after a category is selected;
        // index 0 is the "All channels" pseudo-category.
        const categories = app.mainWindow.locator('.category-item');
        await expect(categories.first()).toBeVisible({ timeout: 10_000 });
        await categories.first().click();

        const channels = app.mainWindow.locator(
            '[data-test-id="channel-item"]'
        );
        await expect(channels.first()).toBeVisible({ timeout: 20_000 });
        await channels.first().click();

        const video = app.mainWindow
            .locator('app-web-player-view video')
            .first();
        await expect(video).toBeVisible({ timeout: 15_000 });

        // Advancing playback past the 403 gate is only possible when the
        // media requests carried the portal cookie and Authorization header.
        await expect
            .poll(
                () =>
                    video.evaluate(
                        (element: HTMLVideoElement) => element.currentTime
                    ),
                { timeout: 20_000 }
            )
            .toBeGreaterThan(0.5);
        await expect(
            app.mainWindow.getByTestId('playback-diagnostic-banner')
        ).toBeHidden();
    } finally {
        await closeElectronApp(app);
    }
});
