import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openSourceEditor,
    saveSourceDialog,
    test,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

test('rejected shared connection edits preserve cached catalogs and history', async ({
    dataDir,
    request,
}) => {
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
    const title = 'Rejected shared catalog edit';
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            contentTypes: ['live', 'movie'],
        });
        await expect
            .poll(() =>
                page.evaluate(async (title) => {
                    const row = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === title);
                    return (
                        row &&
                        (await window.electron.dbGetAppState(
                            `xtream-import-status:${row._id}:live`
                        ))
                    );
                }, title)
            )
            .toBe('completed');
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        const before = await page.evaluate(async (title) => {
            const playlist = (await window.electron.dbGetAppPlaylists()).find(
                (row) => row.title === title
            )!;
            const rows = await window.electron.dbGetContent(
                playlist._id,
                'movie'
            );
            await window.electron.dbAddRecentItem(rows[0].id, playlist._id);
            return {
                id: playlist._id,
                username: playlist.username,
                sample: await window.electron.dbGetContentByXtreamId(
                    rows[0].xtream_id,
                    playlist._id,
                    'movie'
                ),
                xtreamId: rows[0].xtream_id,
                history: await window.electron.dbGetRecentItems(playlist._id),
            };
        }, title);
        expect(before.sample).not.toBeNull();
        await openSources(page);
        let dialog = await openSourceEditor(page, title);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .uncheck();
        await saveSourceDialog(page, dialog);
        await openSources(page);
        dialog = await openSourceEditor(page, title);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        await dialog
            .locator('[formcontrolname="username"]')
            .fill('edited-user');

        const current = await request.get(
            `${server.apiUrl}/v1/sources/${before.id}`
        );
        expect(current.ok()).toBe(true);
        const changed = await request.patch(
            `${server.apiUrl}/v1/sources/${before.id}`,
            {
                headers: {
                    'If-Match': current.headers()['etag'],
                    'X-IPTVnator-Instance-Id': instance.instanceId,
                },
                data: {
                    ...(await current.json()),
                    title: 'Concurrent server edit',
                },
            }
        );
        expect(changed.ok()).toBe(true);
        recorder.actions.length = 0;
        await dialog
            .locator('mat-dialog-actions')
            .getByRole('button', { name: 'Save', exact: true })
            .click();
        await expect(
            page
                .getByText(
                    'The shared source changed on another device. Refresh and reapply your edit.',
                    { exact: true }
                )
                .first()
        ).toBeVisible();
        await expect(
            dialog.getByRole('button', { name: 'Save', exact: true })
        ).toBeEnabled();
        expect(recorder.actions).toContain('get_vod_streams');
        expect(
            await page.evaluate(
                ({ id, xtreamId }) =>
                    window.electron.dbGetContentByXtreamId(
                        xtreamId,
                        id,
                        'movie'
                    ),
                before
            )
        ).toEqual(before.sample);
        expect(
            await page.evaluate(
                (id) => window.electron.dbGetRecentItems(id),
                before.id
            )
        ).toEqual(before.history);
        expect(
            await page.evaluate(
                async (id) =>
                    (await window.electron.dbGetAppPlaylist(id))?.username,
                before.id
            )
        ).toBe(before.username);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
        await server.close();
    }
});
