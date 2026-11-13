import type { Page } from '@playwright/test';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSourceEditor,
    openSources,
    openWorkspaceSection,
    restartElectronApp,
    saveSourceDialog,
    sourceRowByTitle,
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
    test.setTimeout(150000);
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
        const renamedFavorite = {
            ...favoriteChannel,
            name: 'Updated Favorite Live Channel',
        };
        provider.respond('get_live_streams', [updatedChannel, renamedFavorite]);
        provider.actions.length = 0;
        const releaseLiveResponse = provider.hold('get_live_streams');
        app = await restartElectronApp(app, dataDir);
        await expect
            .poll(() => catalogActions(provider.actions))
            .toEqual(liveRequests);
        await openSources(app.mainWindow);
        await sourceRowByTitle(app.mainWindow, title).click();
        await openWorkspaceSection(app.mainWindow, 'Live TV');
        await app.mainWindow.waitForURL(/\/live$/);
        const oldCategoryId = await app.mainWindow.evaluate(async (id) => {
            const categories = await window.electron.dbGetAllCategories(
                id,
                'live'
            );
            return categories.find((category) => category.name === 'Sports')
                ?.id;
        }, playlistId);
        expect(oldCategoryId).toBeDefined();
        // The live sidebar normally selects a category in place. Enter a
        // category deep link to exercise the URL and browser-history path.
        const oldUrl = `${app.mainWindow.url()}/${oldCategoryId}?q=Favorite`;
        await app.mainWindow.evaluate(async (url) => {
            const debug = Reflect.get(window, 'ng');
            const root = document.querySelector('app-root');
            const app = debug.getComponent(root) as {
                router: { navigateByUrl(path: string): Promise<boolean> };
            };
            const route = new URL(url);
            const path = route.pathname.slice(
                route.pathname.indexOf('/workspace/')
            );
            if (!(await app.router.navigateByUrl(path + route.search))) {
                throw new Error('Could not open the test category route.');
            }
        }, oldUrl);
        const channelItem = (name: string) =>
            app.mainWindow
                .getByTestId('channel-item')
                .filter({ hasText: name });
        await expect(channelItem(favoriteChannel.name)).toBeVisible();
        await expect(app.mainWindow).toHaveURL(oldUrl);
        releaseLiveResponse();
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
                titles: [renamedFavorite.name, updatedChannel.name],
            });
        await expect(channelItem(renamedFavorite.name)).toBeVisible();
        const newCategoryId = await app.mainWindow.evaluate(async (id) => {
            const categories = await window.electron.dbGetAllCategories(
                id,
                'live'
            );
            return categories.find((category) => category.name === 'Sports')
                ?.id;
        }, playlistId);
        expect(newCategoryId).toBeDefined();
        const updatedUrl = oldUrl.replace(
            /\/live\/\d+\?/,
            `/live/${newCategoryId}?`
        );
        expect(updatedUrl).not.toBe(oldUrl);
        await expect(app.mainWindow).toHaveURL(updatedUrl);
        await openSources(app.mainWindow);
        await app.mainWindow.goBack();
        await expect(app.mainWindow).toHaveURL(updatedUrl);
        await expect(channelItem(renamedFavorite.name)).toBeVisible();
        expect(catalogActions(provider.actions)).toEqual(liveRequests);

        provider.respond('get_live_streams', [{ category_id: '1002' }]);
        app = await restartElectronApp(app, dataDir);
        await expect(
            app.mainWindow.getByText(
                'Couldn’t refresh one or more Xtream sources on startup.'
            )
        ).toBeVisible();
        expect(await liveTitles(app.mainWindow, playlistId)).toEqual(
            expect.arrayContaining([updatedChannel.name, renamedFavorite.name])
        );

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
