import { expect, test } from './pwa-mock.fixture';
import {
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
    saveSourceDialog,
    sourceRowByTitle,
    updateSourceDialog,
} from './sources-pwa.helpers';

test.beforeEach(async ({ page }) => {
    await interceptPwaProviderRequests(page);
    await page.goto('/');
});

test('@sources @pwa keeps the welcome page reachable on a phone', async ({
    page,
}) => {
    await page.setViewportSize({ width: 411, height: 810 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/workspace/sources');

    const heading = page.getByRole('heading', { name: 'Add your first source' });
    await expect(heading).toBeInViewport({ ratio: 1 });
    const addStalker = page.getByRole('button', {
        name: 'Add Stalker',
        exact: true,
    });
    await addStalker.scrollIntoViewIfNeeded();
    await expect(addStalker).toBeInViewport({ ratio: 1 });
    await addStalker.click();
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('@sources @pwa opens Xtream source details without Electron DB bridge calls', async ({
    page,
    pwaMocks,
}) => {
    const runtimeErrors = collectRuntimeErrors(page);

    await expectElectronBridgeUnavailable(page);
    await addXtreamPortal(page, 'PWA Xtream Source', pwaMocks);
    await openSources(page);
    await expect(sourceRowByTitle(page, 'PWA Xtream Source')).toBeVisible({
        timeout: 15_000,
    });

    const dialog = await openSourceEditor(page, 'PWA Xtream Source');
    await expectSourceDialogValues(dialog, {
        password: 'pass1',
        serverUrl: XTREAM_MOCK_SERVER,
        title: 'PWA Xtream Source',
        username: pwaMocks.username,
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
    pwaMocks,
}) => {
    const runtimeErrors = collectRuntimeErrors(page);

    await expectElectronBridgeUnavailable(page);
    await addStalkerPortal(page, 'PWA Stalker Source', pwaMocks);
    await openSources(page);

    let dialog = await openSourceEditor(page, 'PWA Stalker Source');
    await updateSourceDialog(dialog, {
        macAddress: pwaMocks.editedMacAddress,
        portalUrl: STALKER_PORTAL_URL,
        title: 'PWA Edited Stalker Source',
    });
    await saveSourceDialog(dialog);

    await expect(sourceRowByTitle(page, 'PWA Edited Stalker Source')).toBeVisible(
        { timeout: 15_000 }
    );

    dialog = await openSourceEditor(page, 'PWA Edited Stalker Source');
    await expectSourceDialogValues(dialog, {
        macAddress: pwaMocks.editedMacAddress,
        portalUrl: STALKER_PORTAL_URL,
        title: 'PWA Edited Stalker Source',
    });
    await closeSourceDialog(dialog);

    expectNoElectronDbRuntimeErrors(runtimeErrors);
});
