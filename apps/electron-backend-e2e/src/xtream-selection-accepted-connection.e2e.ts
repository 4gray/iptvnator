import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    addXtreamPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openSourceEditor,
    sourceRowByTitle,
    test,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

test('a catalog-only edit cannot install arrays fetched with a superseded shared connection', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(120000);
    const server = await startSourceSyncServer();
    const previous = await recordCatalogRequests();
    const current = await recordCatalogRequests();
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
    const title = 'Concurrent synthetic connection';
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: previous.url,
            username: 'performance',
            password: 'performance',
            contentTypes: ['live'],
        });
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        await openSources(page);
        const id = await page.evaluate(
            async (title) =>
                (await window.electron.dbGetAppPlaylists()).find(
                    (row) => row.title === title
                )!._id,
            title
        );
        let dialog = await openSourceEditor(page, title);
        await dialog
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        const before = await request.get(`${server.apiUrl}/v1/sources/${id}`);
        const changed = await request.patch(
            `${server.apiUrl}/v1/sources/${id}`,
            {
                headers: {
                    'If-Match': before.headers()['etag'],
                    'X-IPTVnator-Instance-Id': instance.instanceId,
                },
                data: { ...(await before.json()), serverUrl: current.url },
            }
        );
        expect(changed.ok()).toBe(true);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect
            .poll(() =>
                page.evaluate(
                    async (id) =>
                        (await window.electron.dbGetAppPlaylist(id))?.serverUrl,
                    id
                )
            )
            .toBe(current.url);
        previous.actions.length = 0;
        current.actions.length = 0;
        await dialog
            .locator('mat-dialog-actions')
            .getByRole('button', { name: 'Save', exact: true })
            .click();
        await expect(
            dialog.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        await expect(
            dialog.getByRole('button', { name: 'Save', exact: true })
        ).toBeEnabled();
        expect(
            previous.actions.filter((action) => action === 'get_vod_streams')
        ).toHaveLength(1);
        expect(current.actions).not.toContain('get_vod_streams');
        expect(
            await page.evaluate(
                async (id) =>
                    (await window.electron.dbGetContent(id, 'movie')).length,
                id
            )
        ).toBe(0);
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.electron.dbGetAppState(
                            `xtream-history-recovery:${id}`
                        ),
                    id
                )
            )
            .toBeFalsy();
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        await page.waitForSelector('mat-dialog-container', {
            state: 'detached',
        });
        // The accepted device selection stays saved, while its stale arrays do
        // not become a completed cache. Opening the source imports the new one.
        await sourceRowByTitle(page, title)
            .locator('.source-row__name')
            .click();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        window.electron.dbGetAppState(
                            `xtream-import-status:${id}:movie`
                        ),
                    id
                )
            )
            .toBe('completed');
        expect(current.actions).toContain('get_vod_streams');
        await expect(
            page.locator('.workspace-loading-overlay')
        ).not.toBeVisible();
        await openSources(page);
        dialog = await openSourceEditor(page, title);
        await expect(
            dialog.locator('[formcontrolname="serverUrl"]')
        ).toHaveValue(current.url);
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .click();
    } finally {
        await closeElectronApp(app);
        await previous.close();
        await current.close();
        await server.close();
    }
});
