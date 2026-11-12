import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSourceEditor,
    openSources,
    restartElectronApp,
    saveSourceDialog,
    test,
    updateSourceDialog,
    waitForSourceRowIdle,
} from './electron-test-fixtures';
import {
    catalogActions,
    recordCatalogRequests,
} from './xtream-selection.e2e-support';

const title = 'Startup test portal';
const liveRequests = ['get_live_categories', 'get_live_streams'];

async function liveTitles(page: Page, playlistId: string) {
    return page.evaluate(async (id) => {
        const rows = await window.electron.dbGetContent(id, 'live');
        return rows.map((row) => row.title);
    }, playlistId);
}

test('refreshes opted-in Xtream live channels on restart and keeps the saved catalog on provider failure', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const provider = await recordCatalogRequests();
    let app = await launchElectronApp(dataDir);
    const channel = {
        stream_id: 2001,
        category_id: '1001',
        name: 'Original Live Channel',
    };
    const favoriteChannel = {
        stream_id: 2002,
        category_id: '1002',
        name: 'Favorite Live Channel',
    };
    provider.respond('get_live_categories', [
        { category_id: '1001', category_name: 'News', parent_id: 0 },
        { category_id: '1002', category_name: 'Sports', parent_id: 0 },
    ]);
    provider.respond('get_live_streams', [channel, favoriteChannel]);

    try {
        await addXtreamPortal(app.mainWindow, {
            name: title,
            serverUrl: provider.url,
            contentTypes: ['live'],
        });
        const playlistId = await app.mainWindow.evaluate(async (name) => {
            const row = (await window.electron.dbGetAppPlaylists()).find(
                (source) => source.title === name
            );
            if (!row) throw new Error('The Xtream test source was not saved.');
            return row._id;
        }, title);
        await expect
            .poll(() =>
                app.mainWindow.evaluate(
                    (id) =>
                        window.electron.dbGetAppState(
                            `xtream-import-status:${id}:live`
                        ),
                    playlistId
                )
            )
            .toBe('completed');
        await expect
            .poll(() => liveTitles(app.mainWindow, playlistId))
            .toContain(channel.name);

        await app.mainWindow.evaluate(async (id) => {
            const [categories, rows] = await Promise.all([
                window.electron.dbGetAllCategories(id, 'live'),
                window.electron.dbGetContent(id, 'live'),
            ]);
            const hidden = categories.find((row) => row.name === 'News');
            const favorite = rows.find(
                (row) => row.title === 'Favorite Live Channel'
            );
            if (!hidden || !favorite)
                throw new Error('The test lineup is incomplete.');
            await window.electron.dbUpdateCategoryVisibility(
                [hidden.id],
                true,
                true
            );
            await window.electron.dbAddFavorite(favorite.id, id);
        }, playlistId);

        await openSources(app.mainWindow);
        await waitForSourceRowIdle(app.mainWindow, title);
        let dialog = await openSourceEditor(app.mainWindow, title);
        await expect(
            dialog.getByRole('checkbox', {
                name: 'Refresh live channels on startup',
            })
        ).not.toBeChecked();
        await updateSourceDialog(dialog, { autoRefresh: true });
        await saveSourceDialog(app.mainWindow, dialog);

        const updatedChannel = { ...channel, name: 'Updated Live Channel' };
        provider.respond('get_live_streams', [updatedChannel, favoriteChannel]);
        provider.actions.length = 0;
        app = await restartElectronApp(app, dataDir);
        await expect
            .poll(() =>
                app.mainWindow.evaluate(async (id) => {
                    const [categories, favorites, rows] = await Promise.all([
                        window.electron.dbGetAllCategories(id, 'live'),
                        window.electron.dbGetFavorites(id),
                        window.electron.dbGetContent(id, 'live'),
                    ]);
                    return {
                        hidden: categories.find((row) => row.name === 'News')
                            ?.hidden,
                        favorite: favorites.some(
                            (row) => row.xtream_id === 2002
                        ),
                        titles: rows.map((row) => row.title).sort(),
                    };
                }, playlistId)
            )
            .toEqual({
                hidden: true,
                favorite: true,
                titles: [favoriteChannel.name, updatedChannel.name],
            });
        expect(catalogActions(provider.actions)).toEqual(liveRequests);

        const allowLiveRequest = provider.fail('get_live_streams');
        app = await restartElectronApp(app, dataDir);
        await expect(
            app.mainWindow.getByText(
                'Couldn’t refresh one or more Xtream sources on startup.'
            )
        ).toBeVisible();
        expect(await liveTitles(app.mainWindow, playlistId)).toContain(
            updatedChannel.name
        );
        allowLiveRequest();

        await openSources(app.mainWindow);
        await waitForSourceRowIdle(app.mainWindow, title);
        dialog = await openSourceEditor(app.mainWindow, title);
        await expect(
            dialog.getByRole('checkbox', {
                name: 'Refresh live channels on startup',
            })
        ).toBeChecked();
        await updateSourceDialog(dialog, { autoRefresh: false });
        await saveSourceDialog(app.mainWindow, dialog);

        provider.actions.length = 0;
        app = await restartElectronApp(app, dataDir);
        await openSources(app.mainWindow);
        dialog = await openSourceEditor(app.mainWindow, title);
        await expect(
            dialog.getByRole('checkbox', {
                name: 'Refresh live channels on startup',
            })
        ).not.toBeChecked();
        expect(catalogActions(provider.actions)).toEqual([]);
    } finally {
        await closeElectronApp(app);
        await provider.close();
    }
});
