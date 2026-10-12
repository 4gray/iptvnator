import type { Locator, Page } from '@playwright/test';
import type { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import {
    closeElectronApp,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    openSources,
    openWorkspaceSection,
    restartElectronApp,
    sourceRowByTitle,
    test,
    waitForM3uCatalog,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

const SOURCE_TITLE = 'group-management-source';
const CHANNELS = ['News', 'Sports', 'Movies'].flatMap((group) =>
    [1, 2].map((index) => ({
        groupTitle: group,
        name: `${group} Channel ${index}`,
        url: `https://streams.example.test/${group.toLowerCase()}-${index}.m3u8`,
    }))
);

function groupNavLabels(page: Page): Locator {
    return page.locator('app-groups-view .group-nav-item .nav-item-label');
}

async function openGroupManagement(page: Page): Promise<Locator> {
    await page
        .getByRole('button', { name: 'Manage groups', exact: true })
        .click();
    const dialog = page.locator('mat-dialog-container').last();
    await expect(dialog.locator('.group-item')).toHaveCount(3);
    return dialog;
}

function groupCheckbox(dialog: Locator, group: string): Locator {
    return dialog
        .locator('.group-item')
        .filter({ hasText: group })
        .getByRole('checkbox');
}

async function storedHiddenGroupTitles(page: Page): Promise<unknown> {
    return page.evaluate(async () => {
        const playlistId = location.pathname.match(
            /\/workspace\/playlists\/([^/]+)/
        )?.[1];
        if (!playlistId) throw new Error('M3U playlist route is missing');
        const api = (window as unknown as { electron: ElectronBridgeApi })
            .electron;
        const playlist = (await api.dbGetAppPlaylist(playlistId)) as {
            hiddenGroupTitles?: unknown;
        } | null;
        const hidden = playlist?.hiddenGroupTitles;
        return Array.isArray(hidden) ? [...hidden].sort() : hidden;
    });
}

test.describe('Electron M3U group management', () => {
    test('keeps groups hidden in Manage groups after a restart (#1894)', async ({
        dataDir,
    }) => {
        const filePath = writeTemporaryM3uFile(
            dataDir,
            `${SOURCE_TITLE}.m3u`,
            CHANNELS
        );
        const app = await launchElectronApp(dataDir);

        try {
            await importM3uPlaylistFromNativeDialog(app, filePath);
            await waitForM3uCatalog(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Groups');
            await expect(groupNavLabels(app.mainWindow)).toHaveText([
                'Movies',
                'News',
                'Sports',
            ]);

            const dialog = await openGroupManagement(app.mainWindow);
            await groupCheckbox(dialog, 'Movies').uncheck();
            await groupCheckbox(dialog, 'Sports').uncheck();
            await dialog
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await expect(dialog).toBeHidden();
            await expect(groupNavLabels(app.mainWindow)).toHaveText(['News']);
            await expect
                .poll(() => storedHiddenGroupTitles(app.mainWindow))
                .toEqual(['Movies', 'Sports']);

            const restarted = await restartElectronApp(app, dataDir);
            app.electronApp = restarted.electronApp;
            app.mainWindow = restarted.mainWindow;

            await openSources(app.mainWindow);
            await sourceRowByTitle(app.mainWindow, SOURCE_TITLE)
                .first()
                .click();
            await waitForM3uCatalog(app.mainWindow);
            await openWorkspaceSection(app.mainWindow, 'Groups');
            await expect(groupNavLabels(app.mainWindow)).toHaveText(['News']);

            // The dialog opens from the restored state, so saving it again
            // cannot silently unhide the groups.
            const reopened = await openGroupManagement(app.mainWindow);
            await expect(groupCheckbox(reopened, 'News')).toBeChecked();
            await expect(groupCheckbox(reopened, 'Movies')).not.toBeChecked();
            await expect(groupCheckbox(reopened, 'Sports')).not.toBeChecked();
            await reopened
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await expect(reopened).toBeHidden();
        } finally {
            await closeElectronApp(app);
        }
    });
});
