import { readFileSync } from 'node:fs';
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
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

async function setReplayFault(
    app: LaunchedElectronApp,
    dataDir: string,
    playlistId: string,
    enabled: boolean
) {
    await app.electronApp.evaluate(
        ({ ipcMain }, { dependency, file, playlistId, enabled }) => {
            const Database = process
                .getBuiltinModule('module')
                .createRequire(dependency)(dependency);
            const db = new Database(file);
            try {
                db.exec(
                    'DROP TRIGGER IF EXISTS synthetic_history_replay_fault'
                );
                if (enabled) {
                    const literal = playlistId.replaceAll("'", "''");
                    db.exec(`CREATE TRIGGER synthetic_history_replay_fault BEFORE INSERT ON recently_viewed
                        WHEN NEW.playlist_id = '${literal}'
                        BEGIN SELECT RAISE(ABORT, 'synthetic history replay fault'); END`);
                }
            } finally {
                db.close();
            }
            if (enabled) {
                type Handler = (...args: unknown[]) => Promise<unknown>;
                const handlers = (
                    ipcMain as typeof ipcMain & {
                        _invokeHandlers: Map<string, Handler>;
                    }
                )._invokeHandlers;
                const original = handlers.get('DB_RESTORE_XTREAM_USER_DATA');
                if (!original) throw new Error('Missing native replay handler');
                ipcMain.removeHandler('DB_RESTORE_XTREAM_USER_DATA');
                ipcMain.handle(
                    'DB_RESTORE_XTREAM_USER_DATA',
                    async (event, id, ...args) => {
                        try {
                            return await original(event, id, ...args);
                        } catch (error) {
                            if (id === playlistId) {
                                (
                                    globalThis as typeof globalThis & {
                                        generationReplayFailed?: boolean;
                                    }
                                ).generationReplayFailed = true;
                            }
                            throw error;
                        }
                    }
                );
            }
        },
        {
            dependency: join(__dirname, '../../../node_modules/better-sqlite3'),
            file: join(dataDir, 'databases/iptvnator.db'),
            playlistId,
            enabled,
        }
    );
}

test('ordinary refresh retry consumes its newly created deferred generation before later history removal', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const recorder = await recordCatalogRequests();
    recorder.respond('get_live_categories', [
        { category_id: '91', category_name: 'Synthetic retained group' },
    ]);
    recorder.respond('get_vod_categories', [
        { category_id: '92', category_name: 'Synthetic active group' },
    ]);
    recorder.respond('get_live_streams', [
        {
            stream_id: 881201,
            name: 'Synthetic retained Live item',
            category_id: '91',
            stream_type: 'live',
            stream_icon: '',
        },
    ]);
    recorder.respond('get_vod_streams', [
        {
            stream_id: 881202,
            name: 'Synthetic active Movie item',
            category_id: '92',
            stream_type: 'movie',
            stream_icon: '',
            container_extension: 'mp4',
        },
    ]);
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    const title = 'Synthetic recovery generation';
    let releaseContent: () => void = () => undefined;
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            contentTypes: ['movie', 'live'],
        });
        const id = await page.evaluate(async (title) => {
            const source = (await window.electron.dbGetAppPlaylists()).find(
                (row) => row.title === title
            );
            if (!source) throw new Error('Synthetic source is missing');
            return source._id;
        }, title);
        await expect
            .poll(() =>
                page.evaluate(
                    async (id) =>
                        (
                            await Promise.all(
                                ['movie', 'live'].map((type) =>
                                    window.electron.dbGetAppState(
                                        `xtream-import-status:${id}:${type}`
                                    )
                                )
                            )
                        ).every((status) => status === 'completed'),
                    id
                )
            )
            .toBe(true);
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        await page.evaluate(async (id) => {
            const row = await window.electron.dbGetContentByXtreamId(
                881201,
                id,
                'live'
            );
            if (!row) throw new Error('Synthetic retained row is missing');
            await window.electron.dbAddRecentItem(row.id, id);
        }, id);
        const editor = await openSourceEditor(page, title);
        await editor
            .getByTestId('xtream-load-live')
            .getByRole('checkbox')
            .uncheck();
        await saveSourceDialog(page, editor);
        // An interrupted deletion may leave disabled native rows with an idle
        // marker. They remain usable from saved items, without a dormant record.
        await page.evaluate(
            (id) =>
                window.electron.dbSetAppState(
                    `xtream-import-status:${id}:live`,
                    'idle'
                ),
            id
        );
        expect(
            await page.evaluate(
                (id) => localStorage.getItem(`xtream-catalog-restore-${id}`),
                id
            )
        ).toBeNull();
        await setReplayFault(app, dataDir, id, true);
        recorder.actions.length = 0;
        releaseContent = recorder.hold('get_vod_streams');
        await refreshSource(page, title, { confirm: true });
        await expect
            .poll(() => recorder.actions.includes('get_vod_streams'))
            .toBe(true);
        const initial = await page.evaluate((id) => {
            const raw = localStorage.getItem(`xtream-restore-${id}`);
            if (!raw) throw new Error('Synthetic recovery is missing');
            const pending = JSON.parse(raw);
            return {
                generation: pending.catalogSnapshot.generation,
                dormant: localStorage.getItem(`xtream-catalog-restore-${id}`),
            };
        }, id);
        expect(initial).toEqual({ generation: null, dormant: null });
        releaseContent();
        await expect
            .poll(() =>
                page.evaluate((id) => {
                    const raw = localStorage.getItem(
                        `xtream-catalog-restore-${id}`
                    );
                    return raw ? JSON.parse(raw).generation : null;
                }, id)
            )
            .not.toBeNull();
        await expect(
            page.getByRole('button', { name: 'Retry', exact: true })
        ).toBeVisible();
        await expect
            .poll(() =>
                app.electronApp.evaluate(
                    () =>
                        (
                            globalThis as typeof globalThis & {
                                generationReplayFailed?: boolean;
                            }
                        ).generationReplayFailed
                )
            )
            .toBe(true);
        const failed = await page.evaluate(async (id) => {
            const raw = localStorage.getItem(`xtream-catalog-restore-${id}`);
            const pendingRaw = localStorage.getItem(`xtream-restore-${id}`);
            if (!pendingRaw)
                throw new Error('Synthetic pending recovery is missing');
            const pending = JSON.parse(pendingRaw);
            const journalRaw = await window.electron.dbGetAppState(
                `xtream-history-recovery:${id}`
            );
            return {
                pending: !!pending,
                owner: pending.catalogSnapshot,
                types: (await window.electron.dbGetAppPlaylist(id))
                    ?.xtreamContentTypes,
                liveStatus: await window.electron.dbGetAppState(
                    `xtream-import-status:${id}:live`
                ),
                movieStatus: await window.electron.dbGetAppState(
                    `xtream-import-status:${id}:movie`
                ),
                journal: journalRaw ? JSON.parse(journalRaw) : null,
                state: raw ? JSON.parse(raw) : null,
            };
        }, id);
        expect(failed.pending).toBe(true);
        expect(failed.state?.generation, JSON.stringify(failed)).toEqual(
            expect.any(String)
        );
        expect(failed.state?.recentlyViewed).toContainEqual(
            expect.objectContaining({ contentType: 'live', xtreamId: 881201 })
        );
        await setReplayFault(app, dataDir, id, false);
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) => localStorage.getItem(`xtream-restore-${id}`),
                    id
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
            .toBe('');
        await page.evaluate(async (id) => {
            const watched = (await window.electron.dbGetRecentItems(id)).find(
                (row) => row.type === 'live' && row.xtream_id === 881201
            );
            if (!watched) throw new Error('Synthetic watch was not restored');
            await window.electron.dbRemoveRecentItem(watched.id, id);
        }, id);
        const output = join(dataDir, 'synthetic-generation-export.json');
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
        ).not.toContain(881201);
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        recorder.actions.length = 0;
        await refreshSource(page, title, { confirm: true });
        await expect
            .poll(() => recorder.actions.includes('get_vod_streams'))
            .toBe(true);
        await expect
            .poll(() =>
                page.evaluate(
                    (id) => localStorage.getItem(`xtream-restore-${id}`),
                    id
                )
            )
            .toBeNull();
        const history = await page.evaluate(
            (id) => window.electron.dbGetRecentItems(id, { all: true }),
            id
        );
        expect(history.map((row) => row.xtream_id)).not.toContain(881201);
    } finally {
        releaseContent();
        await closeElectronApp(app);
        await recorder.close();
    }
});
