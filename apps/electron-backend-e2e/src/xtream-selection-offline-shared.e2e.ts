import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
    PlaylistBackupManifestV1,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openSources,
    restartElectronApp,
    sourceRowByTitle,
    test,
} from './electron-test-fixtures';
import { fetchXtreamVodFixture } from './portal-mock-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';
import {
    catalogActions,
    recordCatalogRequests,
} from './xtream-selection.e2e-support';

test('Live-only backup restores a complete selected cache offline and keeps Movie state dormant', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120000);
    const recorder = await recordCatalogRequests();
    const movie = await fetchXtreamVodFixture(request);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    const title = 'Offline selective backup';
    let closed = false;
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            username: 'minimal',
            password: 'minimal',
            contentTypes: ['live'],
        });
        await expect
            .poll(() =>
                page.evaluate(async (title) => {
                    const source = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === title);
                    return (
                        source &&
                        (await window.electron.dbGetAppState(
                            `xtream-import-status:${source._id}:live`
                        ))
                    );
                }, title)
            )
            .toBe('completed');
        const saved = await page.evaluate(async (title) => {
            const source = (await window.electron.dbGetAppPlaylists()).find(
                (row) => row.title === title
            )!;
            const [live] = await window.electron.dbGetContent(
                source._id,
                'live'
            );
            if (!live) throw new Error('Missing Live fixture');
            return { id: source._id, live: live.xtream_id };
        }, title);
        const entry: XtreamPlaylistBackupEntry = {
            portalType: 'xtream',
            exportedId: saved.id,
            title,
            autoRefresh: false,
            xtreamContentTypes: ['live'],
            connection: {
                serverUrl: recorder.url,
                username: 'minimal',
                password: 'minimal',
            },
            userState: {
                favorites: [],
                playbackPositions: [],
                hiddenCategories: [
                    {
                        categoryType: 'movies',
                        xtreamId: Number(movie.categoryId),
                    },
                ],
                recentlyViewed: [
                    {
                        contentType: 'live',
                        xtreamId: saved.live,
                        viewedAt: '2026-01-01',
                    },
                    {
                        contentType: 'movie',
                        xtreamId: Number(movie.items[0].stream_id),
                        viewedAt: '2026-01-02',
                    },
                ],
            },
        };
        const manifest: PlaylistBackupManifestV1 = {
            kind: 'iptvnator-playlist-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            includeSecrets: true,
            playlists: [entry],
        };
        const input = join(dataDir, 'offline-selection.json');
        writeFileSync(input, JSON.stringify(manifest));
        await recorder.close();
        closed = true;
        await openSettings(page);
        await openSettingsSection(page, 'backup');
        const chooser = page.waitForEvent('filechooser');
        await page
            .locator('#backup')
            .getByRole('button', { name: 'Import', exact: true })
            .click();
        await (await chooser).setFiles(input);
        await expect(page.getByText(/Backup import finished:/)).toBeVisible();
        expect(
            await page.evaluate(
                (id) => localStorage.getItem(`xtream-restore-${id}`),
                saved.id
            )
        ).toBeNull();
        expect(
            (
                await page.evaluate(
                    (id) => window.electron.dbGetRecentItems(id, { all: true }),
                    saved.id
                )
            ).map((row) => row.xtream_id)
        ).toEqual([saved.live]);
        const dormant = await page.evaluate(
            (id) =>
                JSON.parse(
                    localStorage.getItem(`xtream-catalog-restore-${id}`)!
                ),
            saved.id
        );
        expect(dormant.recentlyViewed).toEqual(
            entry.userState.recentlyViewed.slice(1)
        );
        expect(dormant.hiddenCategories).toEqual(
            entry.userState.hiddenCategories
        );
        await openSources(page);
        await sourceRowByTitle(page, title)
            .locator('.source-row__name')
            .click();
        await expect(
            page.locator('app-workspace-context-panel .category-item').first()
        ).toBeVisible({ timeout: 30000 });
        expect(
            await page.evaluate(
                (id) => window.electron.dbHasContent(id, 'live'),
                saved.id
            )
        ).toBe(true);
    } finally {
        await closeElectronApp(app);
        if (!closed) await recorder.close();
    }
});

test('shared-source edits retain device-local catalog choices and dormant history', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120000);
    const server = await startSourceSyncServer();
    const recorder = await recordCatalogRequests();
    const movie = await fetchXtreamVodFixture(request);
    const instance = await (await fetch(`${server.apiUrl}/v1/instance`)).json();
    writeFileSync(
        join(dataDir, 'source-server.json'),
        JSON.stringify({
            apiUrl: server.apiUrl,
            instanceId: instance.instanceId,
        })
    );
    let app = await launchElectronApp(dataDir);
    let page = app.mainWindow;
    const title = 'Remote catalog selection';
    const movieId = Number(movie.items[0].stream_id);
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            username: 'minimal',
            password: 'minimal',
            contentTypes: ['live'],
        });
        await expect
            .poll(() =>
                page.evaluate(async (title) => {
                    const source = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === title);
                    return (
                        source &&
                        (await window.electron.dbGetAppState(
                            `xtream-import-status:${source._id}:live`
                        ))
                    );
                }, title)
            )
            .toBe('completed');
        const id = await page.evaluate(
            async ({ title, instanceId, movieId, categoryId }) => {
                const source = (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                )!;
                const [live] = await window.electron.dbGetContent(
                    source._id,
                    'live'
                );
                await window.electron.dbAddRecentItem(live.id, source._id);
                await window.electron.dbSavePlaybackPosition(source._id, {
                    contentType: 'vod',
                    contentXtreamId: movieId,
                    positionSeconds: 22,
                });
                localStorage.setItem(
                    `iptvnator-server:${instanceId}:xtream-catalog-restore-${source._id}`,
                    JSON.stringify({
                        version: 1,
                        favorites: [],
                        playbackPositions: [
                            {
                                contentType: 'vod',
                                contentXtreamId: movieId,
                                positionSeconds: 9,
                            },
                        ],
                        hiddenCategories: [
                            { categoryType: 'movies', xtreamId: categoryId },
                        ],
                        recentlyViewed: [
                            {
                                contentType: 'movie',
                                xtreamId: movieId,
                                viewedAt: '2026-01-01',
                            },
                        ],
                    })
                );
                return source._id;
            },
            {
                title,
                instanceId: instance.instanceId,
                movieId,
                categoryId: Number(movie.categoryId),
            }
        );
        await openSources(page);
        const inventory = await (
            await fetch(`${server.apiUrl}/v1/sources`)
        ).json();
        const shared = inventory.entries.find(
            (entry: { source: { id: string } }) => entry.source.id === id
        );
        const refused = await fetch(`${server.apiUrl}/v1/sources/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'If-Match': shared.revision,
            },
            body: JSON.stringify({
                ...shared.source,
                xtreamContentTypes: ['live', 'movie'],
            }),
        });
        expect(refused.status).toBe(400);
        const updatedTitle = title + ' renamed remotely';
        const response = await fetch(`${server.apiUrl}/v1/sources/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'If-Match': shared.revision,
            },
            body: JSON.stringify({ ...shared.source, title: updatedTitle }),
        });
        expect(response.status).toBe(200);
        recorder.actions.length = 0;
        app = await restartElectronApp(app, dataDir);
        page = app.mainWindow;
        await openSources(page);
        await sourceRowByTitle(page, updatedTitle)
            .locator('.source-row__name')
            .click();
        await expect(
            page.locator('app-workspace-context-panel .category-item').first()
        ).toBeVisible();
        const local = await page.evaluate(
            async (id) =>
                (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row._id === id
                ),
            id
        );
        expect(local?.xtreamContentTypes).toEqual(['live']);
        expect(
            await page.evaluate(
                (id) => window.electron.dbHasContent(id, 'movie'),
                id
            )
        ).toBe(false);
        expect(catalogActions(recorder.actions)).toEqual([]);
        const dormant = await page.evaluate(
            ({ id, instanceId }) =>
                JSON.parse(
                    localStorage.getItem(
                        `iptvnator-server:${instanceId}:xtream-catalog-restore-${id}`
                    )!
                ),
            { id, instanceId: instance.instanceId }
        );
        expect(dormant.recentlyViewed).toEqual([
            { contentType: 'movie', xtreamId: movieId, viewedAt: '2026-01-01' },
        ]);
        expect(dormant.hiddenCategories).toEqual([
            { categoryType: 'movies', xtreamId: Number(movie.categoryId) },
        ]);
        expect(
            (
                await page.evaluate(
                    (id) => window.electron.dbGetAllPlaybackPositions(id),
                    id
                )
            )[0].positionSeconds
        ).toBe(22);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
        await server.close();
    }
});

test('offline disabled catalog bookmarks settle category loading without importing data', async ({
    dataDir,
}) => {
    const recorder = await recordCatalogRequests();
    let app = await launchElectronApp(dataDir);
    let page = app.mainWindow;
    const title = 'Offline empty source';
    let closed = false;
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            contentTypes: [],
        });
        const id = await page.evaluate(
            async (title) =>
                (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                )!._id,
            title
        );
        await recorder.close();
        closed = true;
        app = await restartElectronApp(app, dataDir);
        page = app.mainWindow;
        await openSources(page);
        await sourceRowByTitle(page, title)
            .locator('.source-row__name')
            .click();
        // A bookmark can still name a section disabled by the saved selection.
        await page.evaluate((id) => {
            const root = location.pathname.split('/workspace/')[0];
            history.pushState({}, '', `${root}/workspace/xtreams/${id}/vod`);
            window.dispatchEvent(new PopStateEvent('popstate'));
        }, id);
        await expect(page).toHaveURL(/\/vod$/);
        await expect(
            page.getByText(title, { exact: true }).first()
        ).toBeVisible();
        await expect(
            page.locator('app-workspace-context-panel .context-skeleton')
        ).toHaveCount(0);
        expect(catalogActions(recorder.actions)).toEqual([]);
        expect(
            await page.evaluate(
                (id) => window.electron.dbHasContent(id, 'movie'),
                id
            )
        ).toBe(false);
    } finally {
        await closeElectronApp(app);
        if (!closed) await recorder.close();
    }
});
