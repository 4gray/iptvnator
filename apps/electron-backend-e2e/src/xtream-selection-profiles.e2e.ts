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
    saveSourceDialog,
    test,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';
import {
    catalogActions,
    recordCatalogRequests,
} from './xtream-selection.e2e-support';

test('server-connected desktop refreshes cached re-enabled catalogs and exports only its own dormant state', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const server = await startSourceSyncServer();
    const recorder = await recordCatalogRequests();
    const instance = await (await fetch(`${server.apiUrl}/v1/instance`)).json();
    writeFileSync(
        join(dataDir, 'source-server.json'),
        JSON.stringify({
            apiUrl: server.apiUrl,
            instanceId: instance.instanceId,
        })
    );
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    const title = 'Server cached catalogs';
    try {
        await addXtreamPortal(page, { name: title, serverUrl: recorder.url });
        await expect
            .poll(() =>
                page.evaluate(async (title) => {
                    const row = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === title);
                    if (!row) return false;
                    return (
                        await Promise.all(
                            ['movie', 'live', 'series'].map((type) =>
                                window.electron.dbGetAppState(
                                    `xtream-import-status:${row._id}:${type}`
                                )
                            )
                        )
                    ).every((status) => status === 'completed');
                }, title)
            )
            .toBe(true);
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        const id = await page.evaluate(
            async (title) =>
                (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                )!._id,
            title
        );
        await openSources(page);
        let dialog = await openSourceEditor(page, title);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .uncheck();
        await saveSourceDialog(page, dialog);
        expect(
            await page.evaluate(
                (id) => window.electron.dbHasContent(id, 'movie'),
                id
            )
        ).toBe(true);
        await openSources(page);
        dialog = await openSourceEditor(page, title);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        recorder.actions.length = 0;
        const release = recorder.hold('get_vod_streams');
        const saving = saveSourceDialog(page, dialog);
        try {
            await expect
                .poll(() => recorder.actions.includes('get_vod_streams'))
                .toBe(true);
            await expect(
                dialog.locator('.workspace-loading-overlay')
            ).toBeVisible();
        } finally {
            release();
            await saving;
        }
        expect(catalogActions(recorder.actions)).toEqual([
            'get_vod_categories',
            'get_vod_streams',
        ]);
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();

        const standaloneKey = `xtream-catalog-restore-${id}`;
        const serverKey = `iptvnator-server:${instance.instanceId}:${standaloneKey}`;
        const archive = (xtreamId: number) =>
            JSON.stringify({
                version: 1,
                favorites: [],
                playbackPositions: [],
                hiddenCategories: [],
                recentlyViewed: [
                    {
                        contentType: 'movie',
                        xtreamId,
                        viewedAt: '2026-01-01T00:00:00.000Z',
                    },
                ],
            });
        await page.evaluate(
            ({ standaloneKey, serverKey, standalone, shared }) => {
                localStorage.setItem(standaloneKey, standalone);
                localStorage.setItem(serverKey, shared);
            },
            {
                standaloneKey,
                serverKey,
                standalone: archive(99001),
                shared: archive(99002),
            }
        );
        const output = join(dataDir, 'profile-export.json');
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
        ).toContain(99002);
        expect(
            exported.userState.recentlyViewed.map((row) => row.xtreamId)
        ).not.toContain(99001);
        expect(
            await page.evaluate(
                (key) => localStorage.getItem(key),
                standaloneKey
            )
        ).toBe(archive(99001));
        await page
            .getByRole('button', { name: 'Delete all', exact: true })
            .click();
        await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Delete everything', exact: true })
            .click();
        await expect(
            page.getByText('All playlists and playlist data were removed.')
        ).toBeVisible();
        expect(
            await page.evaluate((key) => localStorage.getItem(key), serverKey)
        ).toBeNull();
        expect(
            await page.evaluate(
                (key) => localStorage.getItem(key),
                standaloneKey
            )
        ).toBe(archive(99001));
    } finally {
        await closeElectronApp(app);
        await recorder.close();
        await server.close();
    }
});

test('standalone Settings bulk deletion clears dormant catalog data without touching other profiles', async ({
    dataDir,
}) => {
    const recorder = await recordCatalogRequests();
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        const title = 'Bulk deletion dormant state';
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            contentTypes: ['live'],
        });
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        const id = await page.evaluate(
            async (title) =>
                (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                )!._id,
            title
        );
        const key = `xtream-catalog-restore-${id}`;
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.electron.dbGetAppState(
                            `xtream-import-status:${id}:live`
                        ),
                    id
                )
            )
            .toBe('completed');
        const otherKey = `iptvnator-server:other:${key}`;
        const state = JSON.stringify({
            version: 1,
            favorites: [],
            playbackPositions: [],
            hiddenCategories: [{ categoryType: 'movies', xtreamId: 1 }],
            recentlyViewed: [
                { contentType: 'movie', xtreamId: 1, viewedAt: '2026-01-01' },
            ],
        });
        await page.evaluate(
            ({ key, otherKey, state }) => {
                localStorage.setItem(key, state);
                localStorage.setItem(otherKey, state);
            },
            { key, otherKey, state }
        );
        await openSettings(page);
        await openSettingsSection(page, 'backup');
        await page
            .getByRole('button', { name: 'Delete all', exact: true })
            .click();
        await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Delete everything', exact: true })
            .click();
        await expect(
            page.getByText('All playlists and playlist data were removed.')
        ).toBeVisible();
        expect(
            await page.evaluate(() => window.electron.dbGetAppPlaylists())
        ).toEqual([]);
        expect(
            await page.evaluate((key) => localStorage.getItem(key), key)
        ).toBeNull();
        expect(
            await page.evaluate((key) => localStorage.getItem(key), otherKey)
        ).toBe(state);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
