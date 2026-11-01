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
import { recordCatalogRequests } from './xtream-selection.e2e-support';

for (const heldPhase of [
    'series-save',
    'history-restore',
    'series-save-error',
] as const)
    test(`late shared connection changes retain catalog recovery (${heldPhase})`, async ({
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
        const title = `Synthetic late connection ${heldPhase}`;
        try {
            await addXtreamPortal(page, {
                name: title,
                serverUrl: previous.url,
                username: 'performance',
                password: 'performance',
                contentTypes: ['live', 'movie', 'series'],
            });
            const id = await page.evaluate(
                async (title) =>
                    (await window.electron.dbGetAppPlaylists()).find(
                        (row) => row.title === title
                    )!._id,
                title
            );
            // This setup imports every large synthetic catalog. Use the same
            // readiness budget as retry below, including on a busy test host.
            await expect
                .poll(
                    () =>
                        page.evaluate(
                            (id) =>
                                Promise.all(
                                    ['live', 'movie', 'series'].map((type) =>
                                        window.electron.dbGetAppState(
                                            `xtream-import-status:${id}:${type}`
                                        )
                                    )
                                ),
                            id
                        ),
                    { timeout: 60000 }
                )
                .toEqual(['completed', 'completed', 'completed']);
            await expect(
                page.locator('.workspace-loading-overlay')
            ).not.toBeVisible();
            const historyIds = await page.evaluate(async (id) => {
                const identities = [];
                for (const type of ['live', 'movie', 'series'] as const) {
                    const rows = await window.electron.dbGetContent(id, type);
                    if (!rows.length)
                        throw new Error('Missing synthetic catalog');
                    await window.electron.dbAddRecentItem(rows[0].id, id);
                    identities.push(`${type}:${rows[0].xtream_id}`);
                }
                return identities.sort();
            }, id);
            await openSources(page);
            let dialog = await openSourceEditor(page, title);
            for (const type of ['movie', 'series'])
                await dialog
                    .getByTestId(`xtream-load-${type}`)
                    .getByRole('checkbox')
                    .uncheck();
            await saveSourceDialog(page, dialog);
            await openSources(page);
            dialog = await openSourceEditor(page, title);
            for (const type of ['movie', 'series'])
                await dialog
                    .getByTestId(`xtream-load-${type}`)
                    .getByRole('checkbox')
                    .check();

            // Withhold a real native reply after its transaction commits. The
            // server projection must land while the edit-time scan still owns
            // its activity hold, including after an earlier type completed.
            await app.electronApp.evaluate(
                ({ ipcMain }, { id, heldPhase }) => {
                    type Handler = (...args: unknown[]) => Promise<unknown>;
                    const handlers = (
                        ipcMain as typeof ipcMain & {
                            _invokeHandlers: Map<string, Handler>;
                        }
                    )._invokeHandlers;
                    const channel =
                        heldPhase === 'history-restore'
                            ? 'DB_RESTORE_XTREAM_USER_DATA'
                            : 'DB_SAVE_CONTENT';
                    const original = handlers.get(channel)!;
                    const state = globalThis as typeof globalThis & {
                        lateConnectionHeld?: boolean;
                        releaseLateConnection?: () => void;
                    };
                    ipcMain.removeHandler(channel);
                    ipcMain.handle(
                        channel,
                        async (event, playlistId, ...args) => {
                            const result = await original(
                                event,
                                playlistId,
                                ...args
                            );
                            if (
                                playlistId === id &&
                                !state.lateConnectionHeld &&
                                (heldPhase === 'history-restore' ||
                                    args[1] === 'series')
                            ) {
                                state.lateConnectionHeld = true;
                                await new Promise<void>((resolve) => {
                                    state.releaseLateConnection = resolve;
                                });
                                if (heldPhase === 'series-save-error')
                                    throw new Error(
                                        'synthetic save reply failure'
                                    );
                            }
                            return result;
                        }
                    );
                },
                { id, heldPhase }
            );
            await dialog
                .locator('mat-dialog-actions')
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await expect
                .poll(() =>
                    app.electronApp.evaluate(
                        () =>
                            !!(
                                globalThis as typeof globalThis & {
                                    releaseLateConnection?: () => void;
                                }
                            ).releaseLateConnection
                    )
                )
                .toBe(true);
            expect(
                await page.evaluate(
                    (id) =>
                        window.electron.dbGetAppState(
                            `xtream-import-status:${id}:movie`
                        ),
                    id
                )
            ).toBe('completed');
            if (heldPhase === 'history-restore')
                expect(
                    await page.evaluate(
                        (id) =>
                            window.electron.dbGetAppState(
                                `xtream-import-status:${id}:series`
                            ),
                        id
                    )
                ).toBe('completed');

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
            await app.electronApp.evaluate(() =>
                (
                    globalThis as typeof globalThis & {
                        releaseLateConnection?: () => void;
                    }
                ).releaseLateConnection!()
            );
            await expect(
                dialog.locator('.workspace-loading-overlay')
            ).not.toBeVisible();
            const after = await page.evaluate(
                async ({ id, pendingKey }) => ({
                    counts: await Promise.all(
                        ['movie', 'series'].map(
                            async (type) =>
                                (
                                    await window.electron.dbGetContent(
                                        id,
                                        type as 'movie' | 'series'
                                    )
                                ).length
                        )
                    ),
                    pending: !!localStorage.getItem(pendingKey),
                    journal: await window.electron.dbGetAppState(
                        `xtream-history-recovery:${id}`
                    ),
                    statuses: await Promise.all(
                        ['movie', 'series'].map((type) =>
                            window.electron.dbGetAppState(
                                `xtream-import-status:${id}:${type}`
                            )
                        )
                    ),
                    history: (
                        await window.electron.dbGetRecentItems(id, {
                            all: true,
                        })
                    )
                        .map((row) => `${row.type}:${row.xtream_id}`)
                        .sort(),
                }),
                {
                    id,
                    pendingKey: `iptvnator-server:${instance.instanceId}:xtream-restore-${id}`,
                }
            );
            expect(after.counts).toEqual([0, 0]);
            expect(after.statuses).not.toContain('completed');
            expect(after.pending).toBe(true);
            expect(after.journal).toBeTruthy();
            expect(after.history).toEqual(
                historyIds.filter((id) => id.startsWith('live:'))
            );
            await expect(
                dialog.getByRole('button', { name: 'Close', exact: true })
            ).toBeEnabled();
            await expect(
                dialog.locator('[formcontrolname="serverUrl"]')
            ).toHaveValue(current.url);
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await page.waitForSelector('mat-dialog-container', {
                state: 'detached',
            });
            await sourceRowByTitle(page, title)
                .locator('.source-row__name')
                .click();
            await expect
                .poll(
                    () =>
                        page.evaluate(
                            async (id) =>
                                (
                                    await Promise.all(
                                        ['movie', 'series'].map((type) =>
                                            window.electron.dbGetAppState(
                                                `xtream-import-status:${id}:${type}`
                                            )
                                        )
                                    )
                                ).every((status) => status === 'completed'),
                            id
                        ),
                    { timeout: 60000 }
                )
                .toBe(true);
            await expect(
                page.locator('.workspace-loading-overlay')
            ).not.toBeVisible();
            await expect
                .poll(() =>
                    page.evaluate(
                        async (id) =>
                            (
                                await window.electron.dbGetRecentItems(id, {
                                    all: true,
                                })
                            )
                                .map((row) => `${row.type}:${row.xtream_id}`)
                                .sort(),
                        id
                    )
                )
                .toEqual(historyIds);
            expect(current.actions).toContain('get_vod_streams');
            expect(current.actions).toContain('get_series');
            expect(
                await page.evaluate(
                    async (id) =>
                        Promise.all(
                            ['movie', 'series'].map(
                                async (type) =>
                                    (
                                        await window.electron.dbGetContent(
                                            id,
                                            type as 'movie' | 'series'
                                        )
                                    ).length
                            )
                        ),
                    id
                )
            ).toEqual([20000, 20000]);
        } finally {
            await app.electronApp
                .evaluate(() =>
                    (
                        globalThis as typeof globalThis & {
                            releaseLateConnection?: () => void;
                        }
                    ).releaseLateConnection?.()
                )
                .catch(() => undefined);
            await closeElectronApp(app);
            await previous.close();
            await current.close();
            await server.close();
        }
    });
