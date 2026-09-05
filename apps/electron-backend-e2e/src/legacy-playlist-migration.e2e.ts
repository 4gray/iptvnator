import {
    _electron as electron,
    ElectronApplication,
    Page,
} from '@playwright/test';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import {
    test,
    expect,
    launchElectronApp,
    closeElectronApp,
    buildElectronLaunchEnvironment,
    electronMainPath,
    workspaceRoot,
    openSources,
} from './electron-test-fixtures';
import { seedLegacyProfile, legacyPlaylists } from './legacy-profile-fixture';

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
    retry = false
) {
    const wrapper = join(dataDir, 'recovery-launch.cjs');
    await writeFile(
        wrapper,
        `const {dialog}=require('electron'); dialog.showMessageBox=async()=>({response:${response},checkboxChecked:false}); require(${JSON.stringify(electronMainPath)});`
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
    await page.waitForSelector('app-root');
    await page.waitForFunction(
        () => typeof window.electron?.dbGetAppPlaylists === 'function'
    );
    return { app, page };
}

test.describe('v0.19 profile migration', () => {
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
        let recovered = await launchWithRecoveryChoice(dataDir, 0);
        try {
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
