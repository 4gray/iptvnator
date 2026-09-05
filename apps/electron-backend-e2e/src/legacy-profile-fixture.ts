import { _electron as electron } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { workspaceRoot } from './electron-test-fixtures';

interface LegacyPlaylist extends Record<string, unknown> {
    _id: string;
    title: string;
    count: number;
    importDate: string;
    lastUsage: string;
    autoRefresh: boolean;
}

/** v0.19 Playlist shape, with no type discriminator; endpoints never resolve. */
export function legacyPlaylists(active = 'xtream-2') {
    const base = {
        count: 0,
        importDate: '2025-01-01T00:00:00.000Z',
        lastUsage: '2025-01-01T00:00:00.000Z',
        autoRefresh: false,
        favorites: [],
    };
    const portals: LegacyPlaylist[] = Array.from({ length: 61 }, (_, i) => ({
        ...base,
        _id: `stalker-${i}`,
        title: `Legacy Stalker ${i}`,
        portalUrl: `https://stalker-${i}.invalid/stalker_portal/c/`,
        macAddress: `00:1A:79:00:00:${i.toString(16).padStart(2, '0')}`,
        stalkerSerialNumber: `synthetic-serial-${i}`,
        stalkerDeviceId1: `synthetic-device-${i}`,
        favorites: [
            {
                id: '7',
                name: 'Synthetic favorite',
                cmd: 'ffmpeg http://synthetic.invalid/7',
                stream_type: 'live',
            },
        ],
        recentlyViewed: [
            { id: '8', name: 'Synthetic recent', added_at: '2025-01-02' },
        ],
    }));
    for (let i = 0; i < 3; i++)
        portals.push({
            ...base,
            _id: `xtream-${i}`,
            title: `Legacy Xtream ${i}`,
            serverUrl: `https://xtream-${i}.invalid`,
            username: `synthetic-${i}`,
            password: 'synthetic-only',
            autoRefresh: true,
        });
    portals.push({
        ...base,
        _id: 'm3u',
        title: 'Legacy M3U',
        count: 1,
        favorites: ['channel-1'],
        userAgent: 'LegacySyntheticAgent',
        playlist: {
            header: { raw: '#EXTM3U' },
            items: [
                {
                    id: 'channel-1',
                    name: 'Synthetic channel',
                    url: 'https://channel.invalid/live',
                    group: { title: 'Test' },
                },
            ],
        },
    });
    return portals.map((p) =>
        p._id === active ? { ...p, lastUsage: '2025-12-31T00:00:00.000Z' } : p
    );
}

export async function seedLegacyProfile(
    dataDir: string,
    active = 'xtream-2',
    seedSqlite = true,
    failWrite = false
) {
    const fixture = join(dataDir, 'seed');
    const profile = join(dataDir, 'electron-backend');
    await mkdir(fixture, { recursive: true });
    await mkdir(profile, { recursive: true });
    const index = join(fixture, 'index.html');
    await writeFile(
        index,
        '<!doctype html><title>Synthetic v0.19 profile</title>'
    );
    await writeFile(
        join(fixture, 'package.json'),
        JSON.stringify({
            name: 'electron-backend',
            version: '0.0.1',
            main: 'main.cjs',
        })
    );
    await writeFile(
        join(fixture, 'main.cjs'),
        `const {app,BrowserWindow}=require('electron'); app.setPath('userData',${JSON.stringify(profile)}); app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{sandbox:true}}).loadFile(${JSON.stringify(index)}));`
    );
    const app = await electron.launch({
        args: [
            ...(process.platform === 'linux' && process.env['CI']
                ? ['--no-sandbox', '--disable-gpu']
                : []),
            fixture,
        ],
        env: { ...process.env, NODE_ENV: 'test' },
    });
    try {
        const page = await app.firstWindow();
        await page.waitForLoadState();
        await page.evaluate(async (playlists) => {
            await new Promise<void>((resolve, reject) => {
                const req = indexedDB.open('iptvnator', 1);
                req.onupgradeneeded = () => {
                    const store = req.result.createObjectStore('playlists', {
                        keyPath: '_id',
                        autoIncrement: false,
                    });
                    // Exact v0.19 indexed-db.config.ts schema.
                    for (const field of [
                        '_id',
                        'filename',
                        'title',
                        'count',
                        'playlist',
                        'importDate',
                        'lastUsage',
                        'favorites',
                        'recentlyViewed',
                        'autoRefresh',
                        'url',
                        'filePath',
                    ])
                        store.createIndex(field, field, { unique: false });
                };
                req.onerror = () => reject(req.error);
                req.onsuccess = () => {
                    const db = req.result,
                        tx = db.transaction('playlists', 'readwrite');
                    for (const p of playlists)
                        tx.objectStore('playlists').put(p);
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onabort = () => reject(tx.error);
                };
            });
            // ngx-pwa/local-storage v0.19 defaults; unrelated preferences survive.
            await new Promise<void>((resolve, reject) => {
                const req = indexedDB.open('ngStorage', 1);
                req.onupgradeneeded = () =>
                    req.result.createObjectStore('localStorage');
                req.onerror = () => reject(req.error);
                req.onsuccess = () => {
                    const db = req.result,
                        tx = db.transaction('localStorage', 'readwrite');
                    tx.objectStore('localStorage').put(
                        { language: 'en', player: 'html5', theme: 'dark' },
                        'settings'
                    );
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                };
            });
            localStorage.setItem('volume', '0.37');
        }, legacyPlaylists(active));
        if (seedSqlite) {
            await mkdir(join(dataDir, 'databases'), { recursive: true });
            const sql = await readFile(
                join(
                    workspaceRoot,
                    'apps/electron-backend-e2e/src/fixtures/v019-schema.sql'
                ),
                'utf8'
            );
            await app.evaluate(
                (_electron, { path, dependency, sql, failWrite }) => {
                    const Database = process
                        .getBuiltinModule('module')
                        .createRequire(dependency)(dependency);
                    const db = new Database(path);
                    db.exec(sql);
                    db.prepare(
                        'INSERT INTO playlists (id,name,type,serverUrl,username,password) VALUES (?,?,?,?,?,?)'
                    ).run(
                        'xtream-2',
                        'Legacy Xtream 2',
                        'xtream',
                        'https://stale-cache.invalid',
                        'stale-user',
                        'stale-password'
                    );
                    db.exec(
                        "INSERT INTO categories (id,playlist_id,name,type,xtream_id) VALUES (1,'xtream-2','Synthetic','live',1); INSERT INTO content (id,category_id,title,xtream_id,type) VALUES (1,1,'Cached channel',7,'live'); INSERT INTO favorites (content_id,playlist_id) VALUES (1,'xtream-2'); INSERT INTO recently_viewed (content_id,playlist_id) VALUES (1,'xtream-2');"
                    );
                    if (failWrite)
                        db.exec(
                            "CREATE TRIGGER synthetic_migration_failure BEFORE INSERT ON playlists WHEN NEW.id = 'xtream-1' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END"
                        );
                    db.close();
                },
                {
                    path: join(dataDir, 'databases', 'iptvnator.db'),
                    dependency: join(
                        workspaceRoot,
                        'node_modules/better-sqlite3'
                    ),
                    sql,
                    failWrite,
                }
            );
        }
    } finally {
        await app.close();
    }
}
