import { readFileSync, writeFileSync } from 'node:fs';
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
    openSourceEditor,
    refreshSource,
    saveSourceDialog,
    test,
    waitForSourceRowIdle,
} from './electron-test-fixtures';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

test('missing archived history and categories survive enabling and resolve on a later refresh', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const provider = await recordCatalogRequests();
    const identities = [777701, 777702];
    const categoryIds = [777710, 777711];
    const respond = (count: number) => {
        provider.respond(
            'get_vod_categories',
            categoryIds.slice(0, count).map((id) => ({
                category_id: String(id),
                category_name: `Synthetic dormant category ${id}`,
                parent_id: 0,
            }))
        );
        provider.respond(
            'get_vod_streams',
            identities.slice(0, count).map((id, index) => ({
                stream_id: id,
                name: `Synthetic dormant movie ${id}`,
                category_id: String(categoryIds[index]),
                stream_type: 'movie',
                stream_icon: '',
                container_extension: 'mp4',
            }))
        );
    };
    respond(1);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    const title = 'Synthetic unresolved source';
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: provider.url,
            username: 'performance',
            password: 'performance',
            contentTypes: [],
        });
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        const id = await page.evaluate(async (title) => {
            const source = (await window.electron.dbGetAppPlaylists()).find(
                (row) => row.title === title
            );
            if (!source) throw new Error('Synthetic source was not saved');
            return source._id;
        }, title);
        const entry: XtreamPlaylistBackupEntry = {
            portalType: 'xtream',
            exportedId: id,
            title,
            autoRefresh: false,
            connection: {
                serverUrl: provider.url,
                username: 'performance',
                password: 'performance',
            },
            xtreamContentTypes: [],
            userState: {
                favorites: [],
                recentlyViewed: identities.map((xtreamId) => ({
                    contentType: 'movie',
                    xtreamId,
                    viewedAt: '2026-01-01T00:00:00.000Z',
                })),
                hiddenCategories: categoryIds.map((xtreamId) => ({
                    categoryType: 'movies',
                    xtreamId,
                })),
                playbackPositions: [],
            },
        };
        const archive: PlaylistBackupManifestV1 = {
            kind: 'iptvnator-playlist-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            includeSecrets: true,
            playlists: [entry],
        };
        const input = join(dataDir, 'synthetic-unresolved-input.json');
        const output = join(dataDir, 'synthetic-unresolved-export.json');
        writeFileSync(input, JSON.stringify(archive));
        await openSettings(page);
        await openSettingsSection(page, 'backup');
        const chooser = page.waitForEvent('filechooser');
        await page
            .locator('#backup')
            .getByRole('button', { name: 'Import', exact: true })
            .click();
        await (await chooser).setFiles(input);
        await expect(page.getByText(/Backup import finished:/)).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) => localStorage.getItem(`xtream-restore-${id}`),
                    id
                )
            )
            .toBeNull();
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        const editor = await openSourceEditor(page, title);
        await editor
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        await saveSourceDialog(page, editor);
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        const readState = () =>
            page.evaluate(
                async (id) => ({
                    history: (
                        await window.electron.dbGetRecentItems(id, {
                            all: true,
                        })
                    ).map((row) => row.xtream_id),
                    categories: (
                        await window.electron.dbGetAllCategories(id, 'movies')
                    ).map((row) => ({ id: row.xtream_id, hidden: row.hidden })),
                    dormant: JSON.parse(
                        localStorage.getItem(`xtream-catalog-restore-${id}`) ??
                            '{"hiddenCategories":[],"recentlyViewed":[]}'
                    ),
                }),
                id
            );
        const partial = await readState();
        expect(partial.history).toEqual([identities[0]]);
        expect(partial.categories).toEqual([
            { id: categoryIds[0], hidden: true },
        ]);
        expect(
            partial.dormant.recentlyViewed?.map(
                (row: { xtreamId: number }) => row.xtreamId
            )
        ).toEqual([identities[1]]);
        expect(
            partial.dormant.hiddenCategories?.map(
                (row: { xtreamId: number }) => row.xtreamId
            )
        ).toEqual([categoryIds[1]]);
        await app.electronApp.evaluate(({ dialog }, filePath) => {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        }, output);
        await openSettings(page);
        await openSettingsSection(page, 'backup');
        await page
            .locator('#backup')
            .getByRole('button', { name: 'Export', exact: true })
            .click();
        await expect(page.getByText('Playlist backup exported.')).toBeVisible();
        const exported = (
            JSON.parse(readFileSync(output, 'utf8')) as PlaylistBackupManifestV1
        ).playlists.find(
            (row) => row.portalType === 'xtream'
        ) as XtreamPlaylistBackupEntry;
        expect(
            exported.userState.recentlyViewed.map((row) => row.xtreamId).sort()
        ).toEqual(identities);
        expect(
            exported.userState.hiddenCategories
                .map((row) => row.xtreamId)
                .sort()
        ).toEqual(categoryIds);
        // An already applied watch now belongs to native history, including removal.
        await page.evaluate(
            async ({ id, xtreamId }) => {
                const row = await window.electron.dbGetContentByXtreamId(
                    xtreamId,
                    id,
                    'movie'
                );
                if (!row) throw new Error('Missing synthetic applied movie');
                await window.electron.dbRemoveRecentItem(row.id, id);
            },
            { id, xtreamId: identities[0] }
        );
        respond(2);
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        await refreshSource(page, title, { confirm: true });
        await expect
            .poll(async () => (await readState()).history, { timeout: 60000 })
            .toEqual([identities[1]]);
        await expect
            .poll(
                () =>
                    page.evaluate(
                        (id) => localStorage.getItem(`xtream-restore-${id}`),
                        id
                    ),
                { timeout: 60000 }
            )
            .toBeNull();
        const complete = await readState();
        expect(complete.categories.sort((a, b) => a.id - b.id)).toEqual(
            categoryIds.map((id) => ({ id, hidden: true }))
        );
        expect(complete.dormant.recentlyViewed ?? []).toEqual([]);
        expect(complete.dormant.hiddenCategories ?? []).toEqual([]);
    } finally {
        await closeElectronApp(app);
        await provider.close();
    }
});

test('native history missing from a replacement catalog stays parked until the provider returns it', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const provider = await recordCatalogRequests();
    const ids = [778701, 778702];
    provider.respond('get_vod_categories', [
        {
            category_id: '778710',
            category_name: 'Synthetic retained history category',
            parent_id: 0,
        },
    ]);
    const respond = (count: number) =>
        provider.respond(
            'get_vod_streams',
            ids.slice(0, count).map((stream_id) => ({
                stream_id,
                name: `Synthetic retained movie ${stream_id}`,
                category_id: '778710',
                stream_type: 'movie',
                stream_icon: '',
                container_extension: 'mp4',
            }))
        );
    respond(2);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    const title = 'Synthetic native dormant source';
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: provider.url,
            username: 'performance',
            password: 'performance',
            contentTypes: ['movie'],
        });
        await expect
            .poll(() =>
                page.evaluate(async (title) => {
                    const row = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((source) => source.title === title);
                    return row
                        ? window.electron.dbGetAppState(
                              `xtream-import-status:${row._id}:movie`
                          )
                        : null;
                }, title)
            )
            .toBe('completed');
        const id = await page.evaluate(
            async ({ title, xtreamId }) => {
                const source = (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                );
                if (!source) throw new Error('Missing synthetic source');
                const item = await window.electron.dbGetContentByXtreamId(
                    xtreamId,
                    source._id,
                    'movie'
                );
                if (!item) throw new Error('Missing synthetic watched movie');
                await window.electron.dbAddRecentItem(item.id, source._id);
                return source._id;
            },
            { title, xtreamId: ids[1] }
        );
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        let editor = await openSourceEditor(page, title);
        await editor
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .uncheck();
        await saveSourceDialog(page, editor);
        expect(
            await page.evaluate(
                (id) => localStorage.getItem(`xtream-catalog-restore-${id}`),
                id
            )
        ).toBeNull();
        respond(1);
        editor = await openSourceEditor(page, title);
        await editor
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        await saveSourceDialog(page, editor);
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        const parked = await page.evaluate(
            async (id) => ({
                pending: localStorage.getItem(`xtream-restore-${id}`),
                journal: await window.electron.dbGetAppState(
                    `xtream-history-recovery:${id}`
                ),
                native: (
                    await window.electron.dbGetRecentItems(id, { all: true })
                ).map((row) => row.xtream_id),
                dormant:
                    JSON.parse(
                        localStorage.getItem(`xtream-catalog-restore-${id}`) ??
                            '{}'
                    ).recentlyViewed ?? [],
            }),
            id
        );
        expect(parked.pending).toBeNull();
        expect(parked.journal).toBe('');
        expect(parked.native).toEqual([]);
        expect(parked.dormant).toEqual([
            {
                contentType: 'movie',
                xtreamId: ids[1],
                viewedAt: expect.any(String),
            },
        ]);
        const output = join(dataDir, 'synthetic-native-unresolved-export.json');
        await app.electronApp.evaluate(({ dialog }, filePath) => {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        }, output);
        await openSettings(page);
        await openSettingsSection(page, 'backup');
        await page
            .locator('#backup')
            .getByRole('button', { name: 'Export', exact: true })
            .click();
        await expect(page.getByText('Playlist backup exported.')).toBeVisible();
        const exported = (
            JSON.parse(readFileSync(output, 'utf8')) as PlaylistBackupManifestV1
        ).playlists.find(
            (row) => row.portalType === 'xtream'
        ) as XtreamPlaylistBackupEntry;
        expect(
            exported.userState.recentlyViewed.map((row) => row.xtreamId)
        ).toEqual([ids[1]]);
        respond(2);
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        await refreshSource(page, title, { confirm: true });
        await expect
            .poll(
                () =>
                    page.evaluate(
                        async (id) =>
                            (
                                await window.electron.dbGetRecentItems(id, {
                                    all: true,
                                })
                            ).map((row) => row.xtream_id),
                        id
                    ),
                { timeout: 60000 }
            )
            .toEqual([ids[1]]);
        await expect
            .poll(
                () =>
                    page.evaluate(
                        (id) => localStorage.getItem(`xtream-restore-${id}`),
                        id
                    ),
                { timeout: 60000 }
            )
            .toBeNull();
        expect(
            await page.evaluate(
                (id) =>
                    JSON.parse(
                        localStorage.getItem(`xtream-catalog-restore-${id}`) ??
                            '{}'
                    ).recentlyViewed ?? [],
                id
            )
        ).toEqual([]);
    } finally {
        await closeElectronApp(app);
        await provider.close();
    }
});
