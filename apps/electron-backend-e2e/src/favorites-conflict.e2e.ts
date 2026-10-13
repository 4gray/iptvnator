import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickGridListCardByTitle,
    closeElectronApp,
    contentCardByTitle,
    expect,
    launchElectronApp,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    sourceRowByTitle,
    test,
    waitForXtreamWorkspaceReady,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import { fetchXtreamVodFixture, getXtreamTitle } from './portal-mock-fixtures';
import { readSavedFavorites } from './support/xtream-favorites-catalog';

test('@critical @persistence @xtream @electron rejects a reused favorite identity until the older saved entry is explicitly removed', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(90_000);
    await resetMockServers(request, ['xtream']);
    const credentials = { username: 'minimal', password: 'minimal' };
    const fixture = await fetchXtreamVodFixture(request, credentials);
    const item = fixture.items[0];
    const title = getXtreamTitle(item);
    const sourceTitle = 'Favorite identity conflict';
    const oldTitle = 'Older saved movie';
    let app: LaunchedElectronApp | undefined;
    try {
        app = await launchElectronApp(dataDir);
        await addXtreamPortal(app.mainWindow, {
            ...credentials,
            name: sourceTitle,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        const playlistId = /\/xtreams\/([^/]+)/.exec(
            new URL(app.mainWindow.url()).pathname
        )?.[1];
        if (!playlistId) throw new Error('Expected a playlist route');
        await app.mainWindow
            .getByRole('link', { name: 'Movies', exact: true })
            .click();
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        // Seed an old snapshot and conflicting current metadata via the real
        // worker bridge. The subsequent save/removal runs through the UI.
        await app.mainWindow.evaluate(
            async ({ playlistId, xtreamId, oldTitle }) => {
                const row = await window.electron.dbGetContentByXtreamId(
                    xtreamId,
                    playlistId,
                    'movie'
                );
                if (!row) throw new Error('Expected imported content');
                const metadata =
                    await window.electron.dbSetContentMetadataIfMissing(
                        row.id,
                        {
                            tmdbId: 12345,
                            releaseYear: 2000,
                        }
                    );
                if (!metadata.success)
                    throw new Error('Could not set current movie identity');
                const restored = await window.electron.dbRestoreXtreamFavorites(
                    playlistId,
                    [
                        {
                            xtreamId,
                            contentType: 'movie',
                            addedAt: '2024-01-01',
                            position: 3,
                            snapshot: {
                                title: oldTitle,
                                tmdbId: 99999999,
                            },
                        },
                    ]
                );
                if (!restored.success)
                    throw new Error('Could not seed the older favorite');
            },
            { playlistId, xtreamId: Number(item.stream_id), oldTitle }
        );
        const [before] = await readSavedFavorites(app.mainWindow, playlistId);
        expect(before).toMatchObject({ id: null, title: oldTitle });

        await clickGridListCardByTitle(app.mainWindow, title);
        const addButton = app.mainWindow
            .getByRole('button', { name: 'Add to favorites', exact: true })
            .first();
        await expect(addButton).toBeVisible();
        await addButton.click();
        await expect(
            app.mainWindow.getByText(
                'This source replaced an item you saved. Remove the older entry from Favorites before adding this one.',
                { exact: true }
            )
        ).toBeVisible();
        await expect(addButton).toBeVisible();
        expect(await readSavedFavorites(app.mainWindow, playlistId)).toEqual([
            before,
        ]);

        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        const oldCard = contentCardByTitle(app.mainWindow, oldTitle);
        await oldCard
            .getByRole('button', { name: /remove from favorites/i })
            .click();
        await expect(oldCard).toHaveCount(0);
        await openSources(app.mainWindow);
        await sourceRowByTitle(app.mainWindow, sourceTitle).first().click();
        await waitForXtreamWorkspaceReady(app.mainWindow);
        await app.mainWindow
            .getByRole('link', { name: 'Movies', exact: true })
            .click();
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        await clickGridListCardByTitle(app.mainWindow, title);
        await addButton.click();
        await expect(
            app.mainWindow
                .getByRole('button', {
                    name: 'Remove from favorites',
                    exact: true,
                })
                .first()
        ).toBeVisible();
        const [saved] = await readSavedFavorites(app.mainWindow, playlistId);
        expect(saved.title).toBe(title);
        expect(saved.id).not.toBeNull();
        expect(saved.favorite_id).not.toBe(before.favorite_id);
    } finally {
        if (app) await closeElectronApp(app);
    }
});
