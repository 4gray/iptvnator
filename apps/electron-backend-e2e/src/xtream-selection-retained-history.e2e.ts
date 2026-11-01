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
    restartElectronApp,
    saveSourceDialog,
    sourceRowByTitle,
    test,
    waitForSourceRowIdle,
} from './electron-test-fixtures';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

test('partial deletion recovery consumes retained disabled history before removal and re-enable', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const recorder = await recordCatalogRequests();
    let app = await launchElectronApp(dataDir, {
        env: {
            IPTVNATOR_DB_WORKER_BATCH_DELAY_MS: '80',
            IPTVNATOR_DB_WORKER_ROWS_PER_TRANSACTION: '1000',
        },
    });
    let page = app.mainWindow;
    const title = 'Retained partial catalog history';
    try {
        await addXtreamPortal(page, {
            name: title,
            serverUrl: recorder.url,
            username: 'performance',
            password: 'performance',
            contentTypes: ['live', 'movie'],
        });
        await expect
            .poll(
                () =>
                    page.evaluate(async (title) => {
                        const source = (
                            await window.electron.dbGetAppPlaylists()
                        ).find((row) => row.title === title);
                        return (
                            source &&
                            (
                                await Promise.all(
                                    ['live', 'movie'].map((type) =>
                                        window.electron.dbGetAppState(
                                            `xtream-import-status:${source._id}:${type}`
                                        )
                                    )
                                )
                            ).every((status) => status === 'completed')
                        );
                    }, title),
                { timeout: 60000 }
            )
            .toBe(true);
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        const saved = await page.evaluate(async (title) => {
            const source = (await window.electron.dbGetAppPlaylists()).find(
                (row) => row.title === title
            )!;
            const movies = await window.electron.dbGetContent(
                source._id,
                'movie'
            );
            const watched = [
                ...new Map(
                    movies.map((row) => [row.category_id, row])
                ).values(),
            ];
            if (watched.length < 2)
                throw new Error('Fixture needs multiple movie categories');
            for (const row of watched)
                await window.electron.dbAddRecentItem(row.id, source._id);
            const [category] = await window.electron.dbGetAllCategories(
                source._id,
                'movies'
            );
            await window.electron.dbUpdateCategoryVisibility(
                [category.id],
                true
            );
            const history = watched.map((row) => ({
                contentType: 'movie',
                xtreamId: row.xtream_id,
                viewedAt: '2026-01-01T00:00:00.000Z',
            }));
            const state = {
                favorites: [],
                playbackPositions: [],
                hiddenCategories: [
                    { categoryType: 'movies', xtreamId: category.xtream_id },
                ],
                recentlyViewed: history,
                preservePlaybackPositions: true,
            };
            localStorage.setItem(
                `xtream-restore-${source._id}`,
                JSON.stringify(state)
            );
            await window.electron.dbSetAppState(
                `xtream-history-recovery:${source._id}`,
                JSON.stringify({
                    version: 1,
                    contentTypes: ['live', 'movie', 'series'],
                    recentlyViewed: history,
                })
            );
            const operationId = 'cancel-after-first-native-delete';
            let cancelling: Promise<unknown> | undefined;
            const stop = window.electron.onDbOperationEvent!((event) => {
                if (
                    event.operationId === operationId &&
                    event.phase === 'deleting-content' &&
                    (event.current ?? 0) > 0 &&
                    !cancelling
                )
                    cancelling = window.electron.dbCancelOperation(operationId);
            });
            let cancelled = false;
            try {
                await window.electron.dbDeleteXtreamContent(
                    source._id,
                    operationId,
                    ['movie']
                );
            } catch {
                cancelled = true;
            } finally {
                stop();
            }
            if (cancelling) await cancelling;
            const retained = await window.electron.dbGetContent(
                source._id,
                'movie'
            );
            const ids = new Set(retained.map((row) => row.xtream_id));
            const present = watched.find((row) => ids.has(row.xtream_id));
            const missing = watched.find((row) => !ids.has(row.xtream_id));
            if (!cancelled || !present || !missing)
                throw new Error(
                    'Expected an actual partially cancelled native deletion'
                );
            await window.electron.dbUpdatePlaylist(source._id, {
                xtreamContentTypes: ['live'],
            });
            return {
                id: source._id,
                present: present.xtream_id,
                missing: missing.xtream_id,
                originalCount: movies.length,
                retainedCount: retained.length,
                category: category.xtream_id,
            };
        }, title);
        expect(saved.retainedCount).toBeGreaterThan(0);
        expect(saved.retainedCount).toBeLessThan(saved.originalCount);
        expect(
            await page.evaluate(
                (id) =>
                    window.electron.dbGetAppState(
                        `xtream-import-status:${id}:movie`
                    ),
                saved.id
            )
        ).toBe('idle');
        app = await restartElectronApp(app, dataDir);
        page = app.mainWindow;
        await openSources(page);
        await sourceRowByTitle(page, title)
            .locator('.source-row__name')
            .click();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) => localStorage.getItem(`xtream-restore-${id}`),
                    saved.id
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
                    saved.id
                )
            )
            .toBe('');
        const restored = await page.evaluate(
            (id) => window.electron.dbGetRecentItems(id, { all: true }),
            saved.id
        );
        const target = restored.find(
            (row) => row.type === 'movie' && row.xtream_id === saved.present
        );
        expect(target).toBeTruthy();
        // The normal individual removal API owns the live row once recovery has
        // acknowledged its journal. No dormant copy may resurrect that identity.
        await page.evaluate(
            ({ id, contentId }) =>
                window.electron.dbRemoveRecentItem(contentId, id),
            { id: saved.id, contentId: target!.id }
        );
        const output = join(dataDir, 'retained-history-export.json');
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
        ).not.toContain(saved.present);
        expect(
            exported.userState.recentlyViewed.map((row) => row.xtreamId)
        ).toContain(saved.missing);
        expect(exported.userState.hiddenCategories).toContainEqual({
            categoryType: 'movies',
            xtreamId: saved.category,
        });
        await openSources(page);
        await waitForSourceRowIdle(page, title);
        const editor = await openSourceEditor(page, title);
        await editor
            .getByTestId('xtream-load-movie')
            .getByRole('checkbox')
            .check();
        await saveSourceDialog(page, editor);
        const history = await page.evaluate(
            (id) => window.electron.dbGetRecentItems(id, { all: true }),
            saved.id
        );
        expect(history.map((row) => row.xtream_id)).not.toContain(
            saved.present
        );
        expect(history.map((row) => row.xtream_id)).toContain(saved.missing);
        expect(
            (
                await page.evaluate(
                    (id) => window.electron.dbGetAllCategories(id, 'movies'),
                    saved.id
                )
            ).find((row) => row.xtream_id === saved.category)?.hidden
        ).toBe(true);
    } finally {
        await closeElectronApp(app);
        await recorder.close();
    }
});
