import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    launchElectronApp,
    openWorkspaceSection,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { fetchXtreamEpgFixture } from './portal-mock-fixtures';

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
        await expect(
            dialog.locator('.epg-dialog__btn--primary')
        ).toBeVisible();

        await dialog.locator('.epg-dialog__close').click();
        await app.mainWindow.waitForSelector('.epg-dialog', {
            state: 'detached',
        });
    } finally {
        await closeElectronApp(app);
    }
});
