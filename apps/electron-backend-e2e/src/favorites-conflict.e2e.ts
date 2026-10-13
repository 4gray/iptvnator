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
    restartElectronApp,
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
                const completed = await window.electron.dbSetAppState(
                    `xtream-import-status:${playlistId}:movie`,
                    'completed'
                );
                if (!completed.success)
                    throw new Error('Could not complete the catalog');
                const [saved] =
                    await window.electron.dbGetFavoritesForBackup(playlistId);
                if (saved?.title !== oldTitle)
                    throw new Error(
                        'Unconfirmed catalog identity replaced the saved title'
                    );
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

test('@persistence @xtream @electron retains a late-confirmed snapshot through catalog loss and unavailable legacy storage', async ({
    dataDir,
    request,
}) => {
    await resetMockServers(request, ['xtream']);
    const credentials = { username: 'minimal', password: 'minimal' };
    const fixture = await fetchXtreamVodFixture(request, credentials);
    const item = fixture.items[0];
    const title = getXtreamTitle(item);
    const oldTitle = 'Snapshot before identity confirmation';
    let app: LaunchedElectronApp | undefined;
    try {
        app = await launchElectronApp(dataDir);
        await addXtreamPortal(app.mainWindow, {
            ...credentials,
            name: 'Late confirmed favorite',
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
        const returned = await app.mainWindow.evaluate(
            async ({ playlistId, xtreamId, oldTitle }) => {
                const row = await window.electron.dbGetContentByXtreamId(
                    xtreamId,
                    playlistId,
                    'movie'
                );
                if (!row) throw new Error('Expected imported content');
                const identity = { tmdbId: 99999999, releaseYear: 2000 };
                const restored = await window.electron.dbRestoreXtreamFavorites(
                    playlistId,
                    [
                        {
                            xtreamId,
                            contentType: 'movie',
                            snapshot: {
                                title: oldTitle,
                                posterUrl: 'https://art.invalid/old.jpg',
                                ...identity,
                            },
                        },
                    ]
                );
                if (!restored.success)
                    throw new Error('Could not seed favorite');
                await window.electron.dbSetAppState(
                    `xtream-import-status:${playlistId}:movie`,
                    'completed'
                );
                const [unconfirmed] =
                    await window.electron.dbGetFavoritesForBackup(playlistId);
                if (unconfirmed.title !== oldTitle)
                    throw new Error('Unconfirmed snapshot overwritten');
                const enriched =
                    await window.electron.dbSetContentMetadataIfMissing(
                        row.id,
                        identity
                    );
                if (!enriched.success)
                    throw new Error('Could not confirm identity');
                // No second import completion is allowed to repair the snapshot.
                await window.electron.dbDeleteXtreamContent(playlistId);
                return {
                    poster: row.poster_url,
                    backdrop: row.backdrop_url ?? null,
                };
            },
            { playlistId, xtreamId: Number(item.stream_id), oldTitle }
        );
        const [saved] = await readSavedFavorites(app.mainWindow, playlistId);
        expect(saved).toMatchObject({
            id: null,
            title,
            poster_url: returned.poster,
            backdrop_url: returned.backdrop,
        });
        await app.mainWindow.evaluate((playlistId) => {
            const key = `xtream-restore-${playlistId}`;
            localStorage.setItem(key, JSON.stringify({ favorites: [] }));
            const getItem = Storage.prototype.getItem;
            Storage.prototype.getItem = function (requestedKey) {
                if (requestedKey === key)
                    throw new Error('Storage unavailable');
                return getItem.call(this, requestedKey);
            };
        }, playlistId);
        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        await expect(contentCardByTitle(app.mainWindow, title)).toBeVisible();
        await expect(contentCardByTitle(app.mainWindow, oldTitle)).toHaveCount(
            0
        );
        app = await restartElectronApp(app, dataDir);
        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        await expect(contentCardByTitle(app.mainWindow, title)).toBeVisible();
        expect(await readSavedFavorites(app.mainWindow, playlistId)).toEqual([
            saved,
        ]);
    } finally {
        if (app) await closeElectronApp(app);
    }
});
