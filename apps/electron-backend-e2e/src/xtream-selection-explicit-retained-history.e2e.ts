import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
    PlaylistBackupManifestV1,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import {
    addXtreamPortal,
    channelItemByTitle,
    closeElectronApp,
    expect,
    launchElectronApp,
    openGlobalRecent,
    openSettings,
    openSettingsSection,
    openSources,
    openSourceEditor,
    saveSourceDialog,
    sourceRowByTitle,
    switchUnifiedCollectionScope,
    test,
    waitForSourceRowIdle,
    xtreamMockServer,
} from './electron-test-fixtures';
import { recordCatalogRequests } from './xtream-selection.e2e-support';

for (const routeRetry of [false, true])
    test(`explicit backup history in a retained disabled idle catalog stays removed after export and re-enable (routeRetry=${routeRetry})`, async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120000);
        const response = await request.get(
            `${xtreamMockServer}/player_api.php?username=performance&password=performance&action=get_live_streams`
        );
        const fixture = (await response.json()) as { stream_id: number }[];
        const [retainedId, missingId] = fixture
            .slice(0, 2)
            .map((row) => Number(row.stream_id));
        if (!retainedId || !missingId || retainedId === missingId)
            throw new Error(
                'Synthetic fixture needs two distinct Live identities'
            );
        const recorder = await recordCatalogRequests();
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        const title = 'Synthetic explicit retained source';
        const retainedTitle = 'Synthetic retained Live item';
        try {
            await addXtreamPortal(page, {
                name: title,
                serverUrl: recorder.url,
                username: 'performance',
                password: 'performance',
                contentTypes: [],
            });
            await openSources(page);
            await waitForSourceRowIdle(page, title);
            const saved = await page.evaluate(
                async ({ title, retainedId, retainedTitle }) => {
                    const source = (
                        await window.electron.dbGetAppPlaylists()
                    ).find((row) => row.title === title)!;
                    await window.electron.dbSaveCategories(
                        source._id,
                        [
                            {
                                category_id: '770001',
                                category_name: 'Synthetic retained category',
                                parent_id: 0,
                            },
                        ],
                        'live'
                    );
                    await window.electron.dbSaveContent(
                        source._id,
                        [
                            {
                                stream_id: retainedId,
                                name: retainedTitle,
                                category_id: '770001',
                                stream_type: 'live',
                                stream_icon: '',
                            },
                        ],
                        'live'
                    );
                    // Interrupted deletion can leave actual rows with an idle marker.
                    // Keep that catalog disabled so explicit restore parks its history.
                    await window.electron.dbSetAppState(
                        `xtream-import-status:${source._id}:live`,
                        'idle'
                    );
                    const row = await window.electron.dbGetContentByXtreamId(
                        retainedId,
                        source._id,
                        'live'
                    );
                    if (!row)
                        throw new Error('Missing raw retained synthetic row');
                    return { id: source._id, contentId: row.id };
                },
                { title, retainedId, retainedTitle }
            );
            const entry: XtreamPlaylistBackupEntry = {
                portalType: 'xtream',
                exportedId: saved.id,
                title,
                autoRefresh: false,
                connection: {
                    serverUrl: recorder.url,
                    username: 'performance',
                    password: 'performance',
                },
                xtreamContentTypes: routeRetry ? ['series'] : [],
                userState: {
                    favorites: [
                        {
                            contentType: 'live',
                            xtreamId: retainedId,
                            snapshot: { title: retainedTitle, posterUrl: '' },
                        },
                    ],
                    recentlyViewed: [retainedId, missingId].map((xtreamId) => ({
                        contentType: 'live',
                        xtreamId,
                        viewedAt: '2026-01-01T00:00:00.000Z',
                    })),
                    hiddenCategories: [],
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
            const input = join(
                dataDir,
                'synthetic-explicit-retained-input.json'
            );
            const output = join(
                dataDir,
                'synthetic-explicit-retained-export.json'
            );
            writeFileSync(input, JSON.stringify(archive));
            await openSettings(page);
            await openSettingsSection(page, 'backup');
            const chooser = page.waitForEvent('filechooser');
            await page
                .locator('#backup')
                .getByRole('button', { name: 'Import', exact: true })
                .click();
            await (await chooser).setFiles(input);
            await expect(
                page.getByText(/Backup import finished:/)
            ).toBeVisible();
            if (routeRetry) {
                // Series is absent, so this real backup remains pending until a
                // route bootstrap imports it. Live stays disabled with its idle row.
                await expect
                    .poll(
                        () =>
                            page.evaluate(
                                (id) =>
                                    localStorage.getItem(
                                        `xtream-restore-${id}`
                                    ),
                                saved.id
                            ),
                        { timeout: 60000 }
                    )
                    .not.toBeNull();
                await openSources(page);
                await sourceRowByTitle(page, title)
                    .locator('.source-row__name')
                    .click();
                await expect
                    .poll(
                        () =>
                            page.evaluate(
                                (id) =>
                                    window.electron.dbGetAppState(
                                        `xtream-import-status:${id}:series`
                                    ),
                                saved.id
                            ),
                        { timeout: 60000 }
                    )
                    .toBe('completed');
            }
            await expect
                .poll(
                    () =>
                        page.evaluate(
                            (id) =>
                                localStorage.getItem(`xtream-restore-${id}`),
                            saved.id
                        ),
                    { timeout: 60000 }
                )
                .toBeNull();
            if (routeRetry)
                await expect(
                    page.locator('.workspace-loading-overlay')
                ).not.toBeVisible();
            const retained = await page.evaluate(
                async ({ id, retainedId, missingId }) => ({
                    selection: (await window.electron.dbGetAppPlaylist(id))
                        ?.xtreamContentTypes,
                    status: await window.electron.dbGetAppState(
                        `xtream-import-status:${id}:live`
                    ),
                    row: (
                        await window.electron.dbGetContentByXtreamId(
                            retainedId,
                            id,
                            'live'
                        )
                    )?.id,
                    favorite: (
                        await window.electron.dbGetFavoritesForBackup(id)
                    ).some((row) => row.xtream_id === retainedId),
                    missingHistory: JSON.parse(
                        localStorage.getItem(`xtream-catalog-restore-${id}`) ??
                            '{}'
                    ).recentlyViewed?.some(
                        (row: { xtreamId: number }) =>
                            row.xtreamId === missingId
                    ),
                }),
                { id: saved.id, retainedId, missingId }
            );
            expect(retained.selection).toEqual(routeRetry ? ['series'] : []);
            expect(retained.status).toBe('idle');
            expect(retained.row).toBe(saved.contentId);
            expect(retained.favorite).toBe(true);
            // The independent missing identity must survive while the catalog is absent.
            expect(retained.missingHistory).toBe(true);
            await page.evaluate(
                ({ id, contentId }) =>
                    window.electron.dbAddRecentItem(contentId, id),
                saved
            );
            await openGlobalRecent(page);
            await switchUnifiedCollectionScope(page, 'All playlists');
            // A Live-only history omits the content toggle and selects Live itself.
            const recent = channelItemByTitle(page, retainedTitle).first();
            await expect(recent).toBeVisible();
            await recent.click({ button: 'right' });
            await page
                .getByRole('menuitem', { name: 'Remove from history' })
                .click();
            await expect
                .poll(() =>
                    page.evaluate(
                        async ({ id, retainedId }) =>
                            (
                                await window.electron.dbGetRecentItems(id, {
                                    all: true,
                                })
                            ).some(
                                (row) =>
                                    row.type === 'live' &&
                                    row.xtream_id === retainedId
                            ),
                        { id: saved.id, retainedId }
                    )
                )
                .toBe(false);
            await app.electronApp.evaluate(({ dialog }, filePath) => {
                dialog.showSaveDialog = async () => ({
                    canceled: false,
                    filePath,
                });
            }, output);
            await openSettings(page);
            await openSettingsSection(page, 'backup');
            await page
                .locator('#backup')
                .getByRole('button', { name: 'Export', exact: true })
                .click();
            await expect(
                page.getByText('Playlist backup exported.')
            ).toBeVisible();
            const exported = (
                JSON.parse(
                    readFileSync(output, 'utf8')
                ) as PlaylistBackupManifestV1
            ).playlists.find(
                (row) => row.portalType === 'xtream'
            ) as XtreamPlaylistBackupEntry;
            const exportedHistory = exported.userState.recentlyViewed.map(
                (row) => row.xtreamId
            );
            expect(exportedHistory).not.toContain(retainedId);
            expect(exportedHistory).toContain(missingId);
            await openSources(page);
            await waitForSourceRowIdle(page, title);
            const editor = await openSourceEditor(page, title);
            await editor
                .getByTestId('xtream-load-live')
                .getByRole('checkbox')
                .check();
            await saveSourceDialog(page, editor);
            await expect(
                page.locator('.workspace-loading-overlay')
            ).not.toBeVisible();
            const history = await page.evaluate(
                (id) => window.electron.dbGetRecentItems(id, { all: true }),
                saved.id
            );
            expect(
                history.some(
                    (row) => row.type === 'live' && row.xtream_id === retainedId
                )
            ).toBe(false);
            expect(
                history.some(
                    (row) => row.type === 'live' && row.xtream_id === missingId
                )
            ).toBe(true);
            expect(recorder.actions).toContain('get_live_streams');
        } finally {
            await closeElectronApp(app);
            await recorder.close();
        }
    });
