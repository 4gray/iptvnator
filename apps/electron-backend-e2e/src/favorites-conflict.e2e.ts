import { createServer, get as httpGet } from 'node:http';
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
    xtreamMockServer,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import { fetchXtreamVodFixture, getXtreamTitle } from './portal-mock-fixtures';
import {
    createFavoritesCatalogProxy,
    refreshFavoriteCatalog,
    readSavedFavorites,
    savedFavoriteIdentity,
} from './support/xtream-favorites-catalog';

test('@xtream catalog proxy keeps absolute request targets on the mock upstream', async () => {
    let redirectedRequests = 0;
    const trap = createServer((_request, response) => {
        redirectedRequests++;
        response.end('{"unexpected":"upstream"}');
    });
    await new Promise<void>((resolve) => trap.listen(0, '127.0.0.1', resolve));
    const address = trap.address();
    if (!address || typeof address === 'string')
        throw new Error('Expected TCP address');
    const proxy = await createFavoritesCatalogProxy();
    try {
        const target = new URL(proxy.origin);
        const response = await new Promise<{ status: number; body: string }>(
            (resolve, reject) => {
                const request = httpGet(
                    {
                        hostname: target.hostname,
                        port: target.port,
                        path: `http://127.0.0.1:${address.port}/player_api.php?username=minimal&password=minimal`,
                    },
                    (incoming) => {
                        let body = '';
                        incoming.setEncoding('utf8');
                        incoming.on('data', (chunk) => {
                            body += chunk;
                        });
                        incoming.on('end', () =>
                            resolve({ status: incoming.statusCode ?? 0, body })
                        );
                        incoming.on('error', reject);
                    }
                );
                request.on('error', reject);
            }
        );
        expect(response.status).toBe(200);
        expect(redirectedRequests).toBe(0);
        expect(JSON.parse(response.body)).toHaveProperty('user_info');
    } finally {
        await proxy.close();
        await new Promise<void>((resolve, reject) =>
            trap.close((error) => (error ? reject(error) : resolve()))
        );
    }
});

for (const identityKnown of [true, false]) {
    test(`@critical @persistence @xtream @electron rejects a reused favorite identity discovered in ${identityKnown ? 'catalog' : 'details'} until explicit removal`, async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(90_000);
        await resetMockServers(request, ['xtream']);
        const credentials = { username: 'minimal', password: 'minimal' };
        const fixture = await fetchXtreamVodFixture(request, credentials);
        const item = fixture.items[0];
        // Catalog evidence and the actual detail response describe the same current replacement.
        const response = await request.get(
            `${xtreamMockServer}/player_api.php`,
            {
                params: {
                    ...credentials,
                    action: 'get_vod_info',
                    vod_id: String(item.stream_id),
                },
            }
        );
        expect(response.ok()).toBe(true);
        const detail = await response.json();
        const currentIdentity = {
            tmdbId: Number(detail.info.tmdb_id),
            releaseYear: Number(String(detail.info.releasedate).slice(0, 4)),
        };
        expect(currentIdentity.tmdbId).toBeGreaterThan(0);
        expect(currentIdentity.releaseYear).toBeGreaterThan(1900);
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
            await clickCategoryByNameExact(
                app.mainWindow,
                fixture.categoryName
            );
            // Seed an old snapshot and conflicting current metadata via the real
            // worker bridge. The subsequent save/removal runs through the UI.
            await app.mainWindow.evaluate(
                async ({
                    playlistId,
                    xtreamId,
                    oldTitle,
                    identityKnown,
                    currentIdentity,
                }) => {
                    const row = await window.electron.dbGetContentByXtreamId(
                        xtreamId,
                        playlistId,
                        'movie'
                    );
                    if (!row) throw new Error('Expected imported content');
                    const restored =
                        await window.electron.dbRestoreXtreamFavorites(
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
                        await window.electron.dbGetFavoritesForBackup(
                            playlistId
                        );
                    if (saved?.title !== oldTitle)
                        throw new Error(
                            'Unconfirmed catalog identity replaced the saved title'
                        );
                    if (!identityKnown) return;
                    const metadata =
                        await window.electron.dbSetContentMetadataIfMissing(
                            row.id,
                            currentIdentity
                        );
                    if (!metadata.success)
                        throw new Error('Could not set current movie identity');
                },
                {
                    playlistId,
                    xtreamId: Number(item.stream_id),
                    oldTitle,
                    identityKnown,
                    currentIdentity,
                }
            );
            const [before] = await readSavedFavorites(
                app.mainWindow,
                playlistId
            );
            expect(before).toMatchObject({
                id: identityKnown ? null : expect.any(Number),
                title: oldTitle,
            });

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
            const after = await readSavedFavorites(app.mainWindow, playlistId);
            if (identityKnown) expect(after).toEqual([before]);
            else {
                // Detail evidence detaches the replaceable catalog fields only.
                expect(savedFavoriteIdentity(after)).toEqual(
                    savedFavoriteIdentity([before])
                );
                expect(after[0]).toMatchObject({
                    id: null,
                    catalog_status: 'missing',
                    tmdb_id: 99999999,
                    poster_url: before.poster_url,
                    backdrop_url: before.backdrop_url,
                    release_year: before.release_year,
                });
            }

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
            await clickCategoryByNameExact(
                app.mainWindow,
                fixture.categoryName
            );
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
            const [saved] = await readSavedFavorites(
                app.mainWindow,
                playlistId
            );
            expect(saved.title).toBe(title);
            expect(saved).toMatchObject({
                tmdb_id: currentIdentity.tmdbId,
                release_year: currentIdentity.releaseYear,
            });
            expect(saved.id).not.toBeNull();
            expect(saved.favorite_id).not.toBe(before.favorite_id);
        } finally {
            if (app) await closeElectronApp(app);
        }
    });
}

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

test('@critical @persistence @xtream @electron keeps known conflicts through sparse refresh and restart', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(90_000);
    await resetMockServers(request, ['xtream']);
    const credentials = { username: 'minimal', password: 'minimal' };
    const fixture = await fetchXtreamVodFixture(request, credentials);
    const xtreamId = Number(fixture.items[0].stream_id);
    const proxy = await createFavoritesCatalogProxy();
    const sourceTitle = 'Conflict latch source';
    let app: LaunchedElectronApp | undefined;
    try {
        app = await launchElectronApp(dataDir);
        await addXtreamPortal(app.mainWindow, {
            ...credentials,
            name: sourceTitle,
            serverUrl: proxy.origin,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        const playlistId = /\/xtreams\/([^/]+)/.exec(
            new URL(app.mainWindow.url()).pathname
        )?.[1];
        if (!playlistId) throw new Error('Expected playlist route');
        await app.mainWindow
            .getByRole('link', { name: 'Movies', exact: true })
            .click();
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        await app.mainWindow.evaluate(
            async ({ playlistId, xtreamId }) => {
                const row = await window.electron.dbGetContentByXtreamId(
                    xtreamId,
                    playlistId,
                    'movie'
                );
                if (!row) throw new Error('Missing imported movie');
                await window.electron.dbRestoreXtreamFavorites(playlistId, [
                    {
                        xtreamId,
                        contentType: 'movie',
                        addedAt: '2020-01-01',
                        position: 4,
                        snapshot: {
                            title: 'Saved original before reuse',
                            tmdbId: 100,
                            releaseYear: 2000,
                        },
                    },
                ]);
                await window.electron.dbSetContentMetadataIfMissing(row.id, {
                    tmdbId: 200,
                });
            },
            { playlistId, xtreamId }
        );
        const [before] = await readSavedFavorites(app.mainWindow, playlistId);
        expect(before).toMatchObject({
            title: 'Saved original before reuse',
            id: null,
        });
        await refreshFavoriteCatalog(
            app.mainWindow,
            proxy,
            playlistId,
            sourceTitle,
            'sources'
        );
        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        expect(
            (await readSavedFavorites(app.mainWindow, playlistId))[0]
                .catalog_status
        ).toBe('missing');
        const card = app.mainWindow.getByRole('button', {
            name: 'Saved original before reuse',
            exact: true,
        });
        await expect(card).toHaveAttribute('aria-disabled', 'true');
        await card.dispatchEvent('click');
        await expect(app.mainWindow.locator('app-content-hero')).toHaveCount(0);
        app = await restartElectronApp(app, dataDir);
        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        await expect(
            app.mainWindow.getByRole('button', {
                name: 'Saved original before reuse',
                exact: true,
            })
        ).toHaveAttribute('aria-disabled', 'true');
        const [after] = await readSavedFavorites(app.mainWindow, playlistId);
        expect(savedFavoriteIdentity([after])).toEqual(
            savedFavoriteIdentity([before])
        );
        expect(after.catalog_status).toBe('missing');
        await app.mainWindow.evaluate(
            async ({ playlistId, xtreamId }) => {
                const row = await window.electron.dbGetContentByXtreamId(
                    xtreamId,
                    playlistId,
                    'movie'
                );
                if (!row) throw new Error('Missing sparse movie');
                await window.electron.dbSetContentMetadataIfMissing(row.id, {
                    tmdbId: 100,
                });
                if (
                    (await window.electron.dbGetFavorites(playlistId))[0]
                        .catalog_status !== 'missing'
                )
                    throw new Error('Partial confirmation cleared conflict');
                await window.electron.dbSetContentMetadataIfMissing(row.id, {
                    releaseYear: 2000,
                });
            },
            { playlistId, xtreamId }
        );
        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        const [confirmed] = await readSavedFavorites(
            app.mainWindow,
            playlistId
        );
        expect(confirmed.catalog_status).toBe('present');
        expect(confirmed.favorite_id).toBe(before.favorite_id);
        expect(confirmed.added_at).toBe(before.added_at);
    } finally {
        if (app) await closeElectronApp(app);
        await proxy.close();
    }
});

test('@critical @persistence @xtream @electron detail hearts use the displayed compatible duplicate', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(90_000);
    await resetMockServers(request, ['xtream']);
    const credentials = { username: 'minimal', password: 'minimal' };
    const fixture = await fetchXtreamVodFixture(request, credentials);
    const xtreamId = Number(fixture.items[0].stream_id);
    const proxy = await createFavoritesCatalogProxy();
    proxy.setMode({ kind: 'duplicate', xtreamId });
    let app: LaunchedElectronApp | undefined;
    try {
        app = await launchElectronApp(dataDir);
        await addXtreamPortal(app.mainWindow, {
            ...credentials,
            name: 'Compatible duplicate source',
            serverUrl: proxy.origin,
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        const playlistId = /\/xtreams\/([^/]+)/.exec(
            new URL(app.mainWindow.url()).pathname
        )?.[1];
        if (!playlistId) throw new Error('Missing playlist route');
        await app.mainWindow
            .getByRole('link', { name: 'Movies', exact: true })
            .click();
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        const compatibleId = await app.mainWindow.evaluate(
            async ({ playlistId, xtreamId }) => {
                const first = await window.electron.dbGetContentByXtreamId(
                    xtreamId,
                    playlistId,
                    'movie'
                );
                const rows = await window.electron.dbSearchContent(
                    playlistId,
                    'Compatible duplicate movie',
                    ['movie']
                );
                const compatible = rows.find(
                    (row) => row.xtream_id === xtreamId
                );
                if (!first || !compatible || first.id === compatible.id)
                    throw new Error('Missing distinct duplicate rows');
                await window.electron.dbSetContentMetadataIfMissing(first.id, {
                    tmdbId: 200,
                    releaseYear: 2000,
                });
                await window.electron.dbSetContentMetadataIfMissing(
                    compatible.id,
                    { tmdbId: 100, releaseYear: 1995 }
                );
                await window.electron.dbRestoreXtreamFavorites(playlistId, [
                    {
                        xtreamId,
                        contentType: 'movie',
                        snapshot: {
                            title: 'Saved original',
                            tmdbId: 100,
                            releaseYear: 1995,
                        },
                    },
                ]);
                await window.electron.dbSetAppState(
                    `xtream-import-status:${playlistId}:movie`,
                    'completed'
                );
                return compatible.id;
            },
            { playlistId, xtreamId }
        );
        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        await contentCardByTitle(
            app.mainWindow,
            'Compatible duplicate movie'
        ).click();
        const hero = app.mainWindow.locator('app-content-hero');
        await expect(
            hero.getByRole('button', {
                name: 'Remove from favorites',
                exact: true,
            })
        ).toBeVisible();
        await hero
            .getByRole('button', { name: 'Remove from favorites', exact: true })
            .click();
        expect(await readSavedFavorites(app.mainWindow, playlistId)).toEqual(
            []
        );
        await hero
            .getByRole('button', { name: 'Add to favorites', exact: true })
            .click();
        const [saved] = await readSavedFavorites(app.mainWindow, playlistId);
        expect(saved).toMatchObject({
            id: compatibleId,
            tmdb_id: 100,
            release_year: 1995,
        });
        app = await restartElectronApp(app, dataDir);
        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        expect(
            (await readSavedFavorites(app.mainWindow, playlistId))[0].id
        ).toBe(compatibleId);
    } finally {
        if (app) await closeElectronApp(app);
        await proxy.close();
    }
});
