import {
    _electron as electron,
    ElectronApplication,
    Page,
} from '@playwright/test';
import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import {
    test,
    expect,
    launchElectronApp,
    closeElectronApp,
    buildElectronLaunchEnvironment,
    electronMainPath,
    workspaceRoot,
    openSources,
    openSettings,
    openSettingsSection,
} from './electron-test-fixtures';
import { seedLegacyProfile, legacyPlaylists } from './legacy-profile-fixture';
import { applyTheme } from './theme-contrast';

interface StartupTestGlobals {
    __failPlaylistReads: boolean;
    __deferRecoveredEpg: boolean;
    __releaseStartupEpg: () => void;
    __resolveLegacyRecoveryDialog: () => void;
}

const migrationKey = 'm3u-playlists-indexeddb-to-sqlite-v1';
const recoveryKey = 'playlists-electron-backend-profile-v1';

async function sql(
    app: ElectronApplication,
    dataDir: string,
    statement: string
) {
    return app.evaluate(
        (_electron, { file, dependency, statement }) => {
            const Database = process
                    .getBuiltinModule('module')
                    .createRequire(dependency)(dependency),
                db = new Database(file);
            try {
                return db.prepare(statement).reader
                    ? db.prepare(statement).all()
                    : db.prepare(statement).run();
            } finally {
                db.close();
            }
        },
        {
            file: join(dataDir, 'databases/iptvnator.db'),
            dependency: join(workspaceRoot, 'node_modules/better-sqlite3'),
            statement,
        }
    );
}

async function sourceCount(page: Page) {
    return page.evaluate(
        async () => (await window.electron.dbGetAppPlaylists()).length
    );
}

async function launchWithRecoveryChoice(
    dataDir: string,
    response: number,
    retry = false,
    deferChoice = false,
    startupFault?: 'defer-epg' | 'fail-playlist-reads'
) {
    const wrapper = join(dataDir, 'recovery-launch.cjs');
    await writeFile(
        wrapper,
        `const {dialog,ipcMain}=require('electron');
dialog.showMessageBox=()=>new Promise(resolve=>{const choose=()=>resolve({response:${response},checkboxChecked:false}); ${deferChoice ? 'globalThis.__resolveLegacyRecoveryDialog=choose;' : 'choose();'}});
globalThis.__failPlaylistReads=${startupFault === 'fail-playlist-reads'};
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>handle(channel,async(...args)=>{
    if(channel==='DB_GET_APP_PLAYLIST_METAS' && globalThis.__failPlaylistReads) throw new Error('Synthetic playlist read failure');
    if(channel==='EPG_RECONCILE_SOURCES' && (${startupFault === 'defer-epg'} || globalThis.__deferRecoveredEpg)) await new Promise(resolve=>{globalThis.__releaseStartupEpg=resolve;});
    return handler(...args);
});
require(${JSON.stringify(electronMainPath)});`
    );
    const app = await electron.launch({
        args: [
            ...(process.platform === 'linux' && process.env['CI']
                ? ['--no-sandbox', '--disable-gpu']
                : []),
            wrapper,
            ...(retry ? ['--recover-legacy-playlists'] : []),
        ],
        env: buildElectronLaunchEnvironment(dataDir),
    });
    const page = await app.firstWindow();
    try {
        // The route is intentionally still empty while recovery is pending.
        await page.waitForSelector('app-root', { state: 'attached' });
        await page.waitForFunction(
            () => typeof window.electron?.dbGetAppPlaylists === 'function'
        );
        return { app, page };
    } catch (error) {
        await closeElectronApp({ electronApp: app, mainWindow: page });
        throw error;
    }
}

/** Exercise the same failure after a real backup import clears a loaded store. */
async function verifyBackupReloadRecovery(
    app: ElectronApplication,
    page: Page,
    dataDir: string
) {
    const backupPath = join(dataDir, 'startup-retry-backup.json');
    await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, backupPath);
    await openSettings(page);
    await openSettingsSection(page, 'backup');
    const backup = page.locator('#backup');
    await backup.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByText('Playlist backup exported.')).toBeVisible();
    await app.evaluate(() => {
        (globalThis as typeof globalThis & StartupTestGlobals)[
            '__failPlaylistReads'
        ] = true;
    });
    const chooser = page.waitForEvent('filechooser');
    await backup.getByRole('button', { name: 'Import', exact: true }).click();
    await (await chooser).setFiles(backupPath);
    const startup = page.locator('app-startup-status');
    await expect(startup.getByRole('alert')).toContainText(
        'Your sources could not be loaded'
    );
    await app.evaluate(() => {
        (globalThis as typeof globalThis & StartupTestGlobals)[
            '__failPlaylistReads'
        ] = false;
    });
    await startup.getByRole('button', { name: 'Retry', exact: true }).click();
    await openSources(page);
    await expect(
        page.getByText('Current synthetic source', { exact: true })
    ).toBeVisible();
    await expect(startup.locator('section')).toHaveCount(0);
}

test.describe('v0.19 profile migration', () => {
    for (const response of [0, 1]) {
        test(`keeps current sources usable with a corrupt legacy profile: choice ${response}`, async ({
            dataDir,
        }) => {
            const initial = await launchElectronApp(dataDir);
            try {
                await initial.mainWindow.evaluate(() =>
                    window.electron.dbUpsertAppPlaylist({
                        _id: 'current',
                        title: 'Current synthetic source',
                        count: 0,
                        importDate: '2026-01-01',
                        lastUsage: '2026-01-01',
                        autoRefresh: false,
                    })
                );
            } finally {
                await closeElectronApp(initial);
            }
            const legacy = join(
                dataDir,
                'electron-backend',
                'IndexedDB',
                'file__0.indexeddb.leveldb'
            );
            await mkdir(legacy, { recursive: true });
            const marker = join(legacy, 'CURRENT');
            const corruptManifest = 'Synthetic invalid LevelDB manifest';
            await writeFile(marker, corruptManifest);
            const { app, page } = await launchWithRecoveryChoice(
                dataDir,
                response
            );
            try {
                await openSources(page);
                await expect(
                    page.getByText('Current synthetic source', { exact: true })
                ).toBeVisible();
                expect(await sourceCount(page)).toBe(1);
                expect(await readFile(marker, 'utf8')).toBe(corruptManifest);
                expect(
                    await page.evaluate(
                        (key) => window.electron.dbGetAppState(key),
                        recoveryKey
                    )
                ).toBe(response === 0 ? 'declined' : null);
            } finally {
                await closeElectronApp({ electronApp: app, mainWindow: page });
            }
        });
    }

    for (const fault of ['defer-epg', 'fail-playlist-reads'] as const) {
        test(`keeps startup actionable after declining recovery: ${fault}`, async ({
            dataDir,
        }, testInfo) => {
            const initial = await launchElectronApp(dataDir);
            try {
                await initial.mainWindow.evaluate(() =>
                    window.electron.dbUpsertAppPlaylist({
                        _id: 'current',
                        title: 'Current synthetic source',
                        count: 1,
                        playlist: {
                            header: { raw: '#EXTM3U' },
                            items: [
                                {
                                    id: 'synthetic-channel',
                                    raw: '#EXTINF:-1,Synthetic channel\nhttps://channel.invalid/live',
                                    name: 'Synthetic channel',
                                    url: 'https://channel.invalid/live',
                                    group: { title: 'Test' },
                                },
                            ],
                        },
                        importDate: '2026-01-01',
                        lastUsage: '2026-01-01',
                        autoRefresh: false,
                    })
                );
            } finally {
                await closeElectronApp(initial);
            }
            await seedLegacyProfile(dataDir, 'm3u', false);
            const { app, page } = await launchWithRecoveryChoice(
                dataDir,
                0,
                false,
                false,
                fault
            );
            try {
                await expect
                    .poll(() =>
                        page.evaluate(
                            (key) => window.electron.dbGetAppState(key),
                            recoveryKey
                        )
                    )
                    .toBe('declined');
                const startup = page.locator('app-startup-status section');
                await expect(startup).toHaveCSS('app-region', 'drag');
                if (fault === 'defer-epg') {
                    await expect(page.locator('#initial-splash')).toHaveCount(
                        0
                    );
                    await expect(
                        page.locator('app-startup-status').getByRole('status')
                    ).toContainText('Preparing your library');
                    await expect
                        .poll(() =>
                            app.evaluate(
                                () =>
                                    typeof (
                                        globalThis as typeof globalThis &
                                            StartupTestGlobals
                                    )['__releaseStartupEpg'] === 'function'
                            )
                        )
                        .toBe(true);
                    for (const theme of ['light', 'dark'] as const) {
                        await applyTheme(page, theme);
                        await page.screenshot({
                            path: testInfo.outputPath(`startup-${theme}.png`),
                            animations: 'disabled',
                        });
                    }
                    await page.setViewportSize({ width: 480, height: 640 });
                    await expect(page.locator('body')).toHaveJSProperty(
                        'scrollWidth',
                        480
                    );
                    await page.screenshot({
                        path: testInfo.outputPath('startup-dark-narrow.png'),
                        animations: 'disabled',
                    });
                    await page.setViewportSize({ width: 1280, height: 720 });
                    await app.evaluate(() =>
                        (globalThis as typeof globalThis & StartupTestGlobals)[
                            '__releaseStartupEpg'
                        ]()
                    );
                } else {
                    await expect(page.getByRole('alert')).toContainText(
                        'Your sources could not be loaded'
                    );
                    await expect(
                        startup.getByRole('button', {
                            name: 'Retry',
                            exact: true,
                        })
                    ).toHaveCSS('app-region', 'no-drag');
                    await app.evaluate(() => {
                        const hooks = globalThis as typeof globalThis &
                            StartupTestGlobals;
                        hooks.__failPlaylistReads = false;
                        hooks.__deferRecoveredEpg = true;
                    });
                    await page
                        .getByRole('button', { name: 'Retry', exact: true })
                        .click();
                    // Metadata is readable again, but startup must still wait
                    // for the reconciliation that failed during settings load.
                    await expect
                        .poll(() =>
                            app.evaluate(
                                () =>
                                    typeof (
                                        globalThis as typeof globalThis &
                                            StartupTestGlobals
                                    ).__releaseStartupEpg
                            )
                        )
                        .toBe('function');
                    await expect(startup).toHaveAttribute('role', 'status');
                    await app.evaluate(() => {
                        const hooks = globalThis as typeof globalThis &
                            StartupTestGlobals;
                        hooks.__deferRecoveredEpg = false;
                        hooks.__releaseStartupEpg();
                    });
                }
                await openSources(page);
                await expect(
                    page.getByText('Current synthetic source', { exact: true })
                ).toBeVisible();
                await expect(
                    page.locator('app-startup-status section')
                ).toHaveCount(0);
                if (fault === 'fail-playlist-reads') {
                    await verifyBackupReloadRecovery(app, page, dataDir);
                }
            } finally {
                await closeElectronApp({ electronApp: app, mainWindow: page });
            }
        });
    }

    for (const active of ['xtream-2', 'stalker-60', 'm3u']) {
        test(`imports all 65 sources with ${active} last active, offline`, async ({
            dataDir,
        }) => {
            await seedLegacyProfile(dataDir, active);
            let launched = await launchElectronApp(dataDir);
            try {
                const page = launched.mainWindow;
                await expect.poll(() => sourceCount(page)).toBe(65);
                expect(
                    await launched.electronApp.evaluate(({ app }) =>
                        app.getPath('userData')
                    )
                ).toBe(join(dataDir, 'electron-backend'));
                await openSources(page);
                await expect(
                    page.getByText('Legacy Stalker 0', { exact: true })
                ).toBeVisible();
                await expect(
                    page.getByText('Legacy Xtream 0', { exact: true })
                ).toBeVisible();
                const sources = await page.evaluate(() =>
                    window.electron.dbGetAppPlaylists()
                );
                expect(sources.filter((p) => p.macAddress)).toHaveLength(61);
                expect(sources.filter((p) => p.serverUrl)).toHaveLength(3);
                expect(sources.find((p) => p._id === active)?.lastUsage).toBe(
                    '2025-12-31T00:00:00.000Z'
                );
                expect(sources.find((p) => p._id === 'xtream-2')).toMatchObject(
                    {
                        autoRefresh: true,
                        serverUrl: 'https://xtream-2.invalid',
                        username: 'synthetic-2',
                        password: 'synthetic-only',
                    }
                );
                expect(
                    sources.find((p) => p._id === 'stalker-60')
                ).toMatchObject({
                    stalkerSerialNumber: 'synthetic-serial-60',
                    stalkerDeviceId1: 'synthetic-device-60',
                    favorites: legacyPlaylists().find(
                        (p) => p._id === 'stalker-60'
                    )?.['favorites'],
                });
                expect(sources.find((p) => p._id === 'm3u')).toMatchObject({
                    favorites: ['channel-1'],
                    userAgent: 'LegacySyntheticAgent',
                    count: 1,
                });
                expect(
                    await page.evaluate(() => localStorage.getItem('volume'))
                ).toBe('0.37');
                expect(
                    await page.evaluate(
                        () =>
                            new Promise((resolve, reject) => {
                                const r = indexedDB.open('ngStorage', 1);
                                r.onerror = () => reject(r.error);
                                r.onsuccess = () => {
                                    const db = r.result,
                                        q = db
                                            .transaction('localStorage')
                                            .objectStore('localStorage')
                                            .get('settings');
                                    q.onsuccess = () => {
                                        db.close();
                                        resolve(q.result);
                                    };
                                };
                            })
                    )
                ).toMatchObject({ language: 'en', theme: 'dark' });
                expect(
                    await sql(
                        launched.electronApp,
                        dataDir,
                        'SELECT count(*) AS count FROM content'
                    )
                ).toEqual([{ count: 1 }]);
                expect(
                    await sql(
                        launched.electronApp,
                        dataDir,
                        'SELECT count(*) AS count FROM favorites'
                    )
                ).toEqual([{ count: 1 }]);
                expect(
                    await sql(
                        launched.electronApp,
                        dataDir,
                        'SELECT count(*) AS count FROM recently_viewed'
                    )
                ).toEqual([{ count: 1 }]);
                // Retained source database is independent of current deletion.
                expect(
                    await page.evaluate(
                        () =>
                            new Promise<number>((resolve, reject) => {
                                const r = indexedDB.open('iptvnator', 1);
                                r.onerror = () => reject(r.error);
                                r.onsuccess = () => {
                                    const db = r.result,
                                        q = db
                                            .transaction('playlists')
                                            .objectStore('playlists')
                                            .count();
                                    q.onsuccess = () => {
                                        db.close();
                                        resolve(q.result);
                                    };
                                };
                            })
                    )
                ).toBe(65);
                await page.evaluate(() =>
                    window.electron.dbDeletePlaylist('stalker-0')
                );
            } finally {
                await closeElectronApp(launched);
            }
            launched = await launchElectronApp(dataDir);
            try {
                await expect
                    .poll(() => sourceCount(launched.mainWindow))
                    .toBe(64);
            } finally {
                await closeElectronApp(launched);
            }
        });
    }

    test('rolls back all rows and the receipt on one failed SQLite write, then retries safely', async ({
        dataDir,
    }) => {
        const { electronApp: app, mainWindow: page } =
            await launchElectronApp(dataDir);
        try {
            await page.evaluate(
                async (key) => window.electron.dbSetAppState(key, ''),
                migrationKey
            );
            await sql(
                app,
                dataDir,
                "CREATE TRIGGER synthetic_migration_failure BEFORE INSERT ON playlists WHEN NEW.id = 'xtream-1' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END"
            );
            const result = await page.evaluate(async (sources) => {
                try {
                    await window.electron.dbMigrateAppPlaylists(
                        sources as Parameters<
                            typeof window.electron.dbMigrateAppPlaylists
                        >[0]
                    );
                    return 'unexpected success';
                } catch {
                    return 'failed';
                }
            }, legacyPlaylists());
            expect(result).toBe('failed');
            expect(await sourceCount(page)).toBe(0);
            expect(
                await page.evaluate(
                    (key) => window.electron.dbGetAppState(key),
                    migrationKey
                )
            ).not.toBe('1');
            await sql(app, dataDir, 'DROP TRIGGER synthetic_migration_failure');
            await page.evaluate(
                (sources) =>
                    window.electron.dbMigrateAppPlaylists(
                        sources as Parameters<
                            typeof window.electron.dbMigrateAppPlaylists
                        >[0]
                    ),
                legacyPlaylists()
            );
            expect(await sourceCount(page)).toBe(65);
            await page.evaluate(
                (sources) =>
                    window.electron.dbMigrateAppPlaylists(
                        sources as Parameters<
                            typeof window.electron.dbMigrateAppPlaylists
                        >[0]
                    ),
                legacyPlaylists()
            );
            expect(await sourceCount(page)).toBe(65);
        } finally {
            await closeElectronApp({ electronApp: app, mainWindow: page });
        }
    });
    test('requires explicit recovery for an upgraded profile and preserves current sources/settings and deletions', async ({
        dataDir,
    }) => {
        const initial = await launchElectronApp(dataDir);
        try {
            await initial.mainWindow.evaluate(async () => {
                await window.electron.dbUpsertAppPlaylist({
                    _id: 'xtream-0',
                    title: 'Current edited source',
                    serverUrl: 'https://current.invalid',
                    username: 'current-user',
                    password: 'current-password',
                    count: 0,
                    importDate: '2026-01-01',
                    lastUsage: '2026-01-01',
                    autoRefresh: false,
                });
                localStorage.setItem('volume', '0.73');
            });
        } finally {
            await closeElectronApp(initial);
        }
        await seedLegacyProfile(dataDir, 'xtream-2', false);
        let recovered = await launchWithRecoveryChoice(dataDir, 0, false, true);
        try {
            // Leave the offer pending until renderer startup has reached it.
            // A synchronous stub plus raw DB reads cannot detect a blank route
            // after the real user eventually chooses Keep current sources.
            await expect
                .poll(() =>
                    recovered.app.evaluate(
                        () =>
                            typeof (
                                globalThis as typeof globalThis &
                                    StartupTestGlobals
                            )['__resolveLegacyRecoveryDialog'] === 'function'
                    )
                )
                .toBe(true);
            await recovered.app.evaluate(() =>
                (globalThis as typeof globalThis & StartupTestGlobals)[
                    '__resolveLegacyRecoveryDialog'
                ]()
            );
            await expect
                .poll(() =>
                    recovered.page.evaluate(
                        (key) => window.electron.dbGetAppState(key),
                        recoveryKey
                    )
                )
                .toBe('declined');
            expect(await sourceCount(recovered.page)).toBe(1);
            expect(
                await recovered.app.evaluate(({ app }) =>
                    app.getPath('userData')
                )
            ).toBe(join(dataDir, 'user-data'));
            await openSources(recovered.page);
            await expect(
                recovered.page.getByText('Current edited source', {
                    exact: true,
                })
            ).toBeVisible();
        } finally {
            await closeElectronApp({
                electronApp: recovered.app,
                mainWindow: recovered.page,
            });
        }
        recovered = await launchWithRecoveryChoice(dataDir, 1, true);
        try {
            await expect.poll(() => sourceCount(recovered.page)).toBe(65);
            expect(
                await recovered.page.evaluate(() =>
                    window.electron.dbGetAppPlaylist('xtream-0')
                )
            ).toMatchObject({
                title: 'Current edited source',
                serverUrl: 'https://current.invalid',
                username: 'current-user',
            });
            expect(
                await recovered.page.evaluate(() =>
                    localStorage.getItem('volume')
                )
            ).toBe('0.73');
            await recovered.page.evaluate(() =>
                window.electron.dbDeletePlaylist('stalker-0')
            );
        } finally {
            await closeElectronApp({
                electronApp: recovered.app,
                mainWindow: recovered.page,
            });
        }
        recovered = await launchWithRecoveryChoice(dataDir, 1, true);
        try {
            await expect.poll(() => sourceCount(recovered.page)).toBe(64);
            expect(
                await recovered.page.evaluate(() =>
                    window.electron.dbGetAppPlaylist('stalker-0')
                )
            ).toBeNull();
        } finally {
            await closeElectronApp({
                electronApp: recovered.app,
                mainWindow: recovered.page,
            });
        }
    });
    test('restarts a failed real legacy import without losing the original store or cached data', async ({
        dataDir,
    }) => {
        await seedLegacyProfile(dataDir, 'xtream-2', true, true);
        let launched = await launchElectronApp(dataDir);
        try {
            await expect(
                launched.mainWindow.evaluate(
                    (sources) =>
                        window.electron.dbMigrateAppPlaylists(
                            sources as Parameters<
                                typeof window.electron.dbMigrateAppPlaylists
                            >[0]
                        ),
                    legacyPlaylists()
                )
            ).rejects.toThrow('Legacy playlist migration failed');
            expect(await sourceCount(launched.mainWindow)).toBe(1);
            expect(
                await launched.mainWindow.evaluate(
                    (key) => window.electron.dbGetAppState(key),
                    migrationKey
                )
            ).not.toBe('1');
            expect(
                await sql(
                    launched.electronApp,
                    dataDir,
                    'SELECT count(*) AS count FROM favorites'
                )
            ).toEqual([{ count: 1 }]);
            await sql(
                launched.electronApp,
                dataDir,
                'DROP TRIGGER synthetic_migration_failure'
            );
        } finally {
            await closeElectronApp(launched);
        }
        launched = await launchElectronApp(dataDir);
        try {
            await expect.poll(() => sourceCount(launched.mainWindow)).toBe(65);
        } finally {
            await closeElectronApp(launched);
        }
    });
});
