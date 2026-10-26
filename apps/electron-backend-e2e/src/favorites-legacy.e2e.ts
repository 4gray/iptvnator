import type { XtreamPendingRestoreState } from '@iptvnator/shared/interfaces';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    addXtreamPortal,
    closeElectronApp,
    contentCardByTitle,
    electronMainPath,
    expect,
    launchElectronApp,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    restartElectronApp,
    sourceRowByTitle,
    switchUnifiedCollectionScope,
    test,
    waitForXtreamWorkspaceReady,
    workspaceRoot,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import {
    createFavoritesCatalogProxy,
    readSavedFavorites,
    savedFavoriteIdentity,
} from './support/xtream-favorites-catalog';

test('@critical @persistence @xtream @electron recovers legacy pending favorites without catalog initialization while the portal is unreachable', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(90_000);
    await resetMockServers(request, ['xtream']);
    const proxy = await createFavoritesCatalogProxy();
    const sourceTitle = 'Offline Legacy Favorites';
    const savedTitle = 'Saved offline movie';
    const fallbackTitle = 'Saved movie #910002';
    const legacyState: XtreamPendingRestoreState = {
        favorites: [
            {
                contentType: 'movie',
                xtreamId: 910001,
                addedAt: '2024-06-01T10:00:00.000Z',
                position: 4,
                snapshot: { title: savedTitle },
            },
            {
                contentType: 'movie',
                xtreamId: 910002,
                addedAt: '2024-06-02T10:00:00.000Z',
                position: 5,
            },
        ],
        hiddenCategories: [],
        recentlyViewed: [],
        playbackPositions: [],
    };
    const serializedLegacyState = JSON.stringify(legacyState);
    let app: LaunchedElectronApp | undefined;
    try {
        app = await launchElectronApp(dataDir);
        await addXtreamPortal(app.mainWindow, {
            name: sourceTitle,
            serverUrl: proxy.origin,
            username: 'minimal',
            password: 'minimal',
        });
        await waitForXtreamWorkspaceReady(app.mainWindow);
        const playlistId = /\/xtreams\/([^/]+)/.exec(
            new URL(app.mainWindow.url()).pathname
        )?.[1];
        if (!playlistId)
            throw new Error('The imported Xtream route has no playlist ID');
        await openSources(app.mainWindow);
        proxy.setMode({ kind: 'offline' });
        const catalogActions = [
            'get_live_categories',
            'get_vod_categories',
            'get_series_categories',
            'get_live_streams',
            'get_vod_streams',
            'get_series',
        ];
        const catalogRequestsBefore = catalogActions.map((action) =>
            proxy.responseCount(action)
        );
        const accountRequestsBefore = proxy.responseCount('get_account_info');

        // Recreate an older profile: only pending localStorage owns the favorites.
        // Calling the raw bridge here must not accidentally perform conversion.
        await app.mainWindow.evaluate(
            async ({ id, legacy }) => {
                const deleted = await window.electron.dbDeleteXtreamContent(id);
                if (!deleted.success)
                    throw new Error('Could not clear the test catalog');
                localStorage.setItem(`xtream-restore-${id}`, legacy);
            },
            { id: playlistId, legacy: serializedLegacyState }
        );
        expect(await readSavedFavorites(app.mainWindow, playlistId)).toEqual(
            []
        );

        // Discard the already-loaded renderer store so the next visit must probe
        // the unavailable account before it can consider initializeContent().
        app = await restartElectronApp(app, dataDir);
        await openSources(app.mainWindow);
        await expect(
            sourceRowByTitle(app.mainWindow, sourceTitle).first()
        ).toBeVisible();
        await sourceRowByTitle(app.mainWindow, sourceTitle).first().click();
        await expect(
            app.mainWindow.getByRole('heading', {
                name: 'Portal unavailable',
                exact: true,
            })
        ).toBeVisible();
        expect(proxy.responseCount('get_account_info')).toBeGreaterThan(
            accountRequestsBefore
        );
        expect(
            catalogActions.map((action) => proxy.responseCount(action))
        ).toEqual(catalogRequestsBefore);

        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
        for (const title of [savedTitle, fallbackTitle]) {
            const card = contentCardByTitle(app.mainWindow, title);
            await expect(card).toHaveCount(1);
            await expect(card).toContainText('Catalog status unknown');
            await expect(
                card.locator('.content-card__activation')
            ).toHaveAttribute('aria-disabled', 'true');
        }
        const converted = await readSavedFavorites(app.mainWindow, playlistId);
        expect(converted).toHaveLength(2);
        expect(
            converted.every(
                (row) => row.id === null && row.catalog_status === 'unknown'
            )
        ).toBe(true);
        expect(savedFavoriteIdentity(converted)).toEqual([
            {
                favoriteId: expect.any(Number),
                xtreamId: 910001,
                title: savedTitle,
                addedAt: legacyState.favorites[0].addedAt,
                position: 4,
            },
            {
                favoriteId: expect.any(Number),
                xtreamId: 910002,
                title: fallbackTitle,
                addedAt: legacyState.favorites[1].addedAt,
                position: 5,
            },
        ]);
        expect(
            catalogActions.map((action) => proxy.responseCount(action))
        ).toEqual(catalogRequestsBefore);

        const removedCard = contentCardByTitle(app.mainWindow, savedTitle);
        await removedCard
            .getByRole('button', { name: /remove from favorites/i })
            .click();
        await expect(removedCard).toHaveCount(0);
        const retained = savedFavoriteIdentity(
            converted.filter((row) => row.xtream_id === 910002)
        );
        expect(
            savedFavoriteIdentity(
                await readSavedFavorites(app.mainWindow, playlistId)
            )
        ).toEqual(retained);
        expect(
            await app.mainWindow.evaluate(
                (id) => localStorage.getItem(`xtream-restore-${id}`),
                playlistId
            )
        ).toBe(serializedLegacyState);

        // The unchanged legacy payload remains eligible for reads after restart;
        // the worker's durable conversion receipt must prevent resurrection.
        app = await restartElectronApp(app, dataDir);
        await openSources(app.mainWindow);
        await sourceRowByTitle(app.mainWindow, sourceTitle).first().click();
        await expect(
            app.mainWindow.getByRole('heading', {
                name: 'Portal unavailable',
                exact: true,
            })
        ).toBeVisible();
        await openWorkspaceSection(app.mainWindow, 'Global favorites');
        await switchUnifiedCollectionScope(app.mainWindow, 'All playlists');
        await expect(
            contentCardByTitle(app.mainWindow, fallbackTitle)
        ).toContainText('Catalog status unknown');
        await expect(
            contentCardByTitle(app.mainWindow, savedTitle)
        ).toHaveCount(0);
        expect(
            savedFavoriteIdentity(
                await readSavedFavorites(app.mainWindow, playlistId)
            )
        ).toEqual(retained);
        expect(
            await app.mainWindow.evaluate(
                (id) => localStorage.getItem(`xtream-restore-${id}`),
                playlistId
            )
        ).toBe(serializedLegacyState);
        expect(
            catalogActions.map((action) => proxy.responseCount(action))
        ).toEqual(catalogRequestsBefore);
    } finally {
        try {
            if (app) await closeElectronApp(app);
        } finally {
            await proxy.close();
        }
    }
});

test('@critical @persistence @xtream @electron upgrades orphaned legacy favorites without blocking startup or losing saved rows', async ({
    dataDir,
}) => {
    test.setTimeout(90_000);
    const schema = await readFile(
        join(
            workspaceRoot,
            'libs/shared/database/src/lib/testing/fixtures/v0.24.0-schema.sql'
        ),
        'utf8'
    );
    const databaseFile = join(dataDir, 'databases/iptvnator.db');
    const dependency = join(workspaceRoot, 'node_modules/better-sqlite3');
    const wrapper = join(dataDir, 'legacy-favorites-startup.cjs');
    const seed = `
        INSERT INTO playlists (id, name, type) VALUES ('legacy', 'Legacy favorites', 'xtream');
        INSERT INTO categories (id, playlist_id, name, type, xtream_id)
            VALUES (1, 'legacy', 'Movies', 'movies', 1);
        INSERT INTO content (id, category_id, title, xtream_id, type)
            VALUES (1, 1, 'Legacy saved movie', 7, 'movie');
        INSERT INTO favorites (id, content_id, playlist_id, added_at, position)
            VALUES (42, 1, 'legacy', '2024-01-01', 3),
                   (43, 1, 'deleted-playlist', '2024-01-02', 4);`;
    await mkdir(join(dataDir, 'databases'), { recursive: true });
    await writeFile(
        wrapper,
        `const Database = require(${JSON.stringify(dependency)});
const db = new Database(${JSON.stringify(databaseFile)});
db.pragma('foreign_keys = OFF');
db.exec(${JSON.stringify(schema)});
db.exec(${JSON.stringify(seed)});
db.close();
require(${JSON.stringify(electronMainPath)});`
    );
    let app: LaunchedElectronApp | undefined;
    try {
        app = await launchElectronApp(dataDir, { entryPoint: wrapper });
        for (let startup = 0; startup < 2; startup++) {
            if (startup) app = await restartElectronApp(app, dataDir);
            await openWorkspaceSection(app.mainWindow, 'Global favorites');
            await expect(
                contentCardByTitle(app.mainWindow, 'Legacy saved movie')
            ).toHaveCount(1);
            expect(
                savedFavoriteIdentity(
                    await readSavedFavorites(app.mainWindow, 'legacy')
                )
            ).toEqual([
                {
                    favoriteId: 42,
                    xtreamId: 7,
                    title: 'Legacy saved movie',
                    addedAt: '2024-01-01',
                    position: 3,
                },
            ]);
            // Orphaned favorites have no source to display, but must remain in
            // storage alongside healthy favorites after both startup paths.
            const rows = await app.electronApp.evaluate(
                (_electron, { databaseFile, dependency }) => {
                    const Database = process
                        .getBuiltinModule('module')
                        .createRequire(dependency)(dependency);
                    const db = new Database(databaseFile, { readonly: true });
                    try {
                        return db
                            .prepare(
                                'SELECT id, playlist_id, content_id, title, added_at, position FROM favorites ORDER BY id'
                            )
                            .all();
                    } finally {
                        db.close();
                    }
                },
                { databaseFile, dependency }
            );
            expect(rows).toEqual([
                {
                    id: 42,
                    playlist_id: 'legacy',
                    content_id: 1,
                    title: 'Legacy saved movie',
                    added_at: '2024-01-01',
                    position: 3,
                },
                {
                    id: 43,
                    playlist_id: 'deleted-playlist',
                    content_id: 1,
                    title: 'Legacy saved movie',
                    added_at: '2024-01-02',
                    position: 4,
                },
            ]);
        }
    } finally {
        if (app) await closeElectronApp(app);
    }
});
