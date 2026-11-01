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
    sourceRowByTitle,
    test,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';
import {
    recordCatalogRequests,
    waitForNativeXtreamSource,
} from './xtream-selection.e2e-support';

for (const retained of [false, true])
    test(`a catalog-only edit cannot install arrays fetched with a superseded shared connection (retained=${retained})`, async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120000);
        const server = await startSourceSyncServer();
        const previous = await recordCatalogRequests();
        const current = await recordCatalogRequests();
        const instance = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
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
                contentTypes: retained ? ['live', 'movie'] : ['live'],
            });
            // Dialog closure/native projection precedes route initialization.
            // Stay on the import route until its catalog and activity hold settle.
            await expect(page).toHaveURL(/\/workspace\/xtreams\/[^/]+(?:\/|$)/);
            const id = await waitForNativeXtreamSource(page, title);
            await expect
                .poll(
                    () =>
                        page.evaluate(
                            (id) =>
                                window.electron.dbGetAppState(
                                    `xtream-import-status:${id}:live`
                                ),
                            id
                        ),
                    { timeout: 60000 }
                )
                .toBe('completed');
            await expect(
                page.locator('.workspace-loading-overlay')
            ).not.toBeVisible({ timeout: 60000 });
            await openSources(page);
            let rememberedMovie: number | undefined;
            if (retained) {
                await expect
                    .poll(
                        () =>
                            page.evaluate(
                                (id) =>
                                    window.electron.dbGetAppState(
                                        `xtream-import-status:${id}:movie`
                                    ),
                                id
                            ),
                        { timeout: 60000 }
                    )
                    .toBe('completed');
                rememberedMovie = await page.evaluate(async (id) => {
                    const [row] = await window.electron.dbGetContent(
                        id,
                        'movie'
                    );
                    if (!row)
                        throw new Error('Missing synthetic retained movie');
                    await window.electron.dbAddRecentItem(row.id, id);
                    return row.xtream_id;
                }, id);
                const disabling = await openSourceEditor(page, title);
                await disabling
                    .getByTestId('xtream-load-movie')
                    .getByRole('checkbox')
                    .uncheck();
                await saveSourceDialog(page, disabling);
                await openSources(page);
                expect(
                    await page.evaluate(
                        ({ id, xtreamId }) =>
                            window.electron.dbGetContentByXtreamId(
                                xtreamId,
                                id,
                                'movie'
                            ),
                        { id, xtreamId: rememberedMovie }
                    )
                ).not.toBeNull();
            }
            let dialog = await openSourceEditor(page, title);
            await dialog
                .getByTestId('xtream-load-movie')
                .getByRole('checkbox')
                .check();
            const before = await request.get(
                `${server.apiUrl}/v1/sources/${id}`
            );
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
                            (await window.electron.dbGetAppPlaylist(id))
                                ?.serverUrl,
                        id
                    )
                )
                .toBe(current.url);
            if (rememberedMovie !== undefined)
                expect(
                    await page.evaluate(
                        ({ id, xtreamId }) =>
                            window.electron.dbGetContentByXtreamId(
                                xtreamId,
                                id,
                                'movie'
                            ),
                        { id, xtreamId: rememberedMovie }
                    )
                ).not.toBeNull();
            previous.actions.length = 0;
            current.actions.length = 0;
            const releaseScan = previous.hold('get_vod_streams');
            await dialog
                .locator('mat-dialog-actions')
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            try {
                // Provider category loading precedes this held stream response.
                await expect
                    .poll(() => previous.actions.includes('get_vod_streams'), {
                        timeout: 60000,
                    })
                    .toBe(true);
                await expect(
                    dialog.locator('.workspace-loading-overlay')
                ).toBeVisible();
            } finally {
                releaseScan();
            }
            // Retained-cache rejection may delete 20k native rows before settling.
            await expect(
                dialog.locator('.workspace-loading-overlay')
            ).not.toBeVisible({ timeout: 60000 });
            await expect(
                dialog.getByRole('button', { name: 'Close', exact: true })
            ).toBeEnabled();
            expect(
                previous.actions.filter(
                    (action) => action === 'get_vod_streams'
                )
            ).toHaveLength(1);
            expect(current.actions).not.toContain('get_vod_streams');
            expect(
                await page.evaluate(
                    async (id) =>
                        (await window.electron.dbGetContent(id, 'movie'))
                            .length,
                    id
                )
            ).toBe(0);
            if (rememberedMovie !== undefined)
                expect(
                    await page.evaluate(
                        ({ id, xtreamId }) =>
                            window.electron.dbGetContentByXtreamId(
                                xtreamId,
                                id,
                                'movie'
                            ),
                        { id, xtreamId: rememberedMovie }
                    )
                ).toBeNull();
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
                .toBeTruthy();
            const pendingKey = `iptvnator-server:${instance.instanceId}:xtream-restore-${id}`;
            expect(
                await page.evaluate(
                    (key) => !!localStorage.getItem(key),
                    pendingKey
                )
            ).toBe(true);
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
                .poll(
                    () =>
                        page.evaluate(
                            (id) =>
                                window.electron.dbGetAppState(
                                    `xtream-import-status:${id}:movie`
                                ),
                            id
                        ),
                    { timeout: 60000 }
                )
                .toBe('completed');
            expect(current.actions).toContain('get_vod_streams');
            await expect(
                page.locator('.workspace-loading-overlay')
            ).not.toBeVisible();
            await expect
                .poll(() =>
                    page.evaluate(
                        (key) => localStorage.getItem(key),
                        pendingKey
                    )
                )
                .toBeNull();
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
            if (rememberedMovie !== undefined)
                expect(
                    await page.evaluate(
                        async ({ id, rememberedMovie }) =>
                            (
                                await window.electron.dbGetRecentItems(id, {
                                    all: true,
                                })
                            ).some(
                                (row) =>
                                    row.type === 'movie' &&
                                    row.xtream_id === rememberedMovie
                            ),
                        { id, rememberedMovie }
                    )
                ).toBe(true);
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
