import { expect, test } from './fixtures';
import {
    EDITED_MAC,
    STALKER_PORTAL_URL,
    XTREAM_MOCK_SERVER,
    addM3uUrlPlaylist,
    addStalkerPortal,
    addXtreamPortal,
    closeSourceDialog,
    collectRuntimeErrors,
    expectElectronBridgeUnavailable,
    expectNoElectronDbRuntimeErrors,
    expectSourceDialogValues,
    interceptPwaProviderRequests,
    openSourceEditor,
    openSources,
    resetPwaMockServers,
    saveSourceDialog,
    sourceRowByTitle,
    updateSourceDialog,
} from './sources-pwa.helpers';

test.beforeEach(async ({ page, request }) => {
    await resetPwaMockServers(request);
    await interceptPwaProviderRequests(page);
    await page.goto('/');
});

test('@sources @pwa opens Xtream source details without Electron DB bridge calls', async ({
    page,
}) => {
    const runtimeErrors = collectRuntimeErrors(page);

    await expectElectronBridgeUnavailable(page);
    await addXtreamPortal(page, 'PWA Xtream Source');
    await openSources(page);
    await expect(sourceRowByTitle(page, 'PWA Xtream Source')).toBeVisible({
        timeout: 15_000,
    });

    const dialog = await openSourceEditor(page, 'PWA Xtream Source');
    await expectSourceDialogValues(dialog, {
        password: 'pass1',
        serverUrl: XTREAM_MOCK_SERVER,
        title: 'PWA Xtream Source',
        username: 'user1',
    });
    await closeSourceDialog(dialog);

    expectNoElectronDbRuntimeErrors(runtimeErrors);
});

test('@sources @pwa edits M3U URL source details through the browser flow', async ({
    page,
}) => {
    const runtimeErrors = collectRuntimeErrors(page);

    await expectElectronBridgeUnavailable(page);
    await addM3uUrlPlaylist(page, 'PWA URL Source');
    await openSources(page);

    let dialog = await openSourceEditor(page, 'PWA URL Source');
    await updateSourceDialog(dialog, {
        title: 'PWA Edited URL Source',
    });
    await saveSourceDialog(dialog);

    await expect(sourceRowByTitle(page, 'PWA Edited URL Source')).toBeVisible({
        timeout: 15_000,
    });

    dialog = await openSourceEditor(page, 'PWA Edited URL Source');
    await expectSourceDialogValues(dialog, {
        title: 'PWA Edited URL Source',
    });
    await closeSourceDialog(dialog);

    expectNoElectronDbRuntimeErrors(runtimeErrors);
});

test('@sources @pwa edits Stalker source details through the browser flow', async ({
    page,
}) => {
    const runtimeErrors = collectRuntimeErrors(page);

    await expectElectronBridgeUnavailable(page);
    await addStalkerPortal(page, 'PWA Stalker Source');
    await openSources(page);

    let dialog = await openSourceEditor(page, 'PWA Stalker Source');
    await updateSourceDialog(dialog, {
        macAddress: EDITED_MAC,
        portalUrl: STALKER_PORTAL_URL,
        title: 'PWA Edited Stalker Source',
    });
    await saveSourceDialog(dialog);

    await expect(sourceRowByTitle(page, 'PWA Edited Stalker Source')).toBeVisible(
        { timeout: 15_000 }
    );

    dialog = await openSourceEditor(page, 'PWA Edited Stalker Source');
    await expectSourceDialogValues(dialog, {
        macAddress: EDITED_MAC,
        portalUrl: STALKER_PORTAL_URL,
        title: 'PWA Edited Stalker Source',
    });
    await closeSourceDialog(dialog);

    expectNoElectronDbRuntimeErrors(runtimeErrors);
});
