import { readFile } from 'node:fs/promises';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
    addM3uUrlPlaylist,
    openSources,
    sourceRowByTitle,
} from './sources-pwa.helpers';

/** The storage-enabled backend from playwright.config.ts. */
const STORAGE_BACKEND_URL = `http://localhost:${
    process.env['STORAGE_BACKEND_PORT'] ?? '3334'
}`;

/** A fresh browser profile (a "device") whose runtime config points at it. */
async function newServerPage(browser: Browser): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/assets/app-config.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: ${JSON.stringify(STORAGE_BACKEND_URL)} };\n`,
        })
    );
    return page;
}

/** A legacy browser playlist, written before the app boots. */
async function seedBrowserPlaylist(
    page: Page,
    id: string,
    title: string
): Promise<void> {
    await page.route('**/__indexeddb-seed__', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
    );
    await page.goto('/__indexeddb-seed__');
    await page.evaluate(
        ([playlistId, playlistTitle]) =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.open('iptvnator', 1);
                request.onerror = () => reject(request.error);
                request.onupgradeneeded = () => {
                    const store = request.result.createObjectStore(
                        'playlists',
                        { keyPath: '_id', autoIncrement: false }
                    );
                    for (const name of [
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
                    ]) {
                        store.createIndex(name, name, { unique: false });
                    }
                };
                request.onsuccess = () => {
                    const db = request.result;
                    const transaction = db.transaction(
                        'playlists',
                        'readwrite'
                    );
                    transaction.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    transaction.onabort = () => {
                        db.close();
                        reject(transaction.error);
                    };
                    transaction.objectStore('playlists').add({
                        _id: playlistId,
                        title: playlistTitle,
                        importDate: '2026-01-01T00:00:00.000Z',
                        lastUsage: '2026-01-01T00:00:00.000Z',
                        count: 1,
                        autoRefresh: false,
                        favorites: [],
                        recentlyViewed: [],
                        playlist: {
                            header: { attrs: {}, raw: '#EXTM3U' },
                            items: [
                                {
                                    id: 'c1',
                                    name: 'Channel',
                                    url: 'https://example.invalid/c1.m3u8',
                                },
                            ],
                        },
                    });
                };
            }),
        [id, title] as const
    );
}

test.describe('server storage @self-hosted @persistence', () => {
    // Both tests share one server database, and so would the other browser
    // projects: keep it to one browser.
    test.describe.configure({ mode: 'serial' });
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'One shared server database'
    );

    test.beforeEach(async ({ request }) => {
        const response = await request.delete(
            `${STORAGE_BACKEND_URL}/v1/playlists`
        );
        expect(response.ok()).toBe(true);
    });

    test('a playlist added on one device appears on another', async ({
        browser,
    }) => {
        const first = await newServerPage(browser);
        await openSources(first);
        await addM3uUrlPlaylist(first, 'Shared M3U');

        const second = await newServerPage(browser);
        await openSources(second);
        await expect(sourceRowByTitle(second, 'Shared M3U')).toBeVisible();

        await first.context().close();
        await second.context().close();
    });

    test('adopts legacy M3U and Stalker activity once for an established browser', async ({
        browser,
        request,
    }) => {
        const page = await newServerPage(browser);
        const m3uId = 'legacy-m3u';
        const stalkerId = 'legacy-stalker';
        const stream = 'https://streams.example.test/legacy.ts';
        const m3u = {
            _id: m3uId,
            title: 'Legacy M3U',
            count: 1,
            favorites: [stream],
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'channel',
                    url: stream,
                    title: 'Legacy channel',
                    category_id: 'live',
                    added_at: '2026-10-26',
                },
            ],
            playlist: {
                header: { raw: '#EXTM3U' },
                items: [{ id: 'channel', name: 'Legacy channel', url: stream }],
            },
        };
        const stalker = {
            _id: stalkerId,
            title: 'Legacy Stalker',
            portalUrl: 'https://portal.example.test/portal.php',
            macAddress: '02:00:00:00:00:01',
            favorites: [
                {
                    id: 'movie',
                    name: 'Legacy movie',
                    category_id: 'vod',
                    cmd: 'legacy-command',
                },
            ],
            recentlyViewed: [
                {
                    id: 'movie',
                    name: 'Legacy watched',
                    category_id: 'vod',
                    cmd: 'legacy-command',
                },
            ],
            stalkerToken: 'never-copy-this-session',
        };
        for (const row of [m3u, stalker])
            expect(
                (
                    await request.put(
                        `${STORAGE_BACKEND_URL}/v1/playlists/${row._id}`,
                        { data: row }
                    )
                ).ok()
            ).toBe(true);
        const instance = await (
            await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
        ).json();
        await page.addInitScript(
            (id) => localStorage.setItem('iptvnator-server:cache-owner', id),
            instance.instanceId
        );
        const legacyReads: string[] = [];
        page.on('request', (outgoing) => {
            if (
                new URL(outgoing.url()).pathname === '/v1/playlists' &&
                outgoing.method() === 'GET'
            )
                legacyReads.push(outgoing.url());
        });
        async function exportActivity() {
            await page.goto('/workspace/settings/backup');
            const downloading = page.waitForEvent('download');
            await page
                .getByRole('button', { name: 'Export', exact: true })
                .click();
            const path = await (await downloading).path();
            if (!path) throw new Error('Missing local backup');
            return JSON.parse(await readFile(path, 'utf8'));
        }
        try {
            const first = await exportActivity();
            const m3uEntry = first.playlists.find(
                (row: { exportedId: string }) => row.exportedId === m3uId
            );
            const stalkerEntry = first.playlists.find(
                (row: { exportedId: string }) => row.exportedId === stalkerId
            );
            expect(m3uEntry.userState).toMatchObject({
                favorites: [stream],
                recentlyViewed: [expect.objectContaining({ url: stream })],
            });
            expect(stalkerEntry.userState).toMatchObject({
                favorites: [expect.objectContaining({ name: 'Legacy movie' })],
                recentlyViewed: [
                    expect.objectContaining({ name: 'Legacy watched' }),
                ],
            });
            expect(JSON.stringify(first)).not.toContain(
                'never-copy-this-session'
            );
            expect(
                (
                    await request.put(
                        `${STORAGE_BACKEND_URL}/v1/playlists/${m3uId}`,
                        { data: { ...m3u, favorites: [], recentlyViewed: [] } }
                    )
                ).ok()
            ).toBe(true);
            const second = await exportActivity();
            expect(
                second.playlists.find(
                    (row: { exportedId: string }) => row.exportedId === m3uId
                ).userState.favorites
            ).toEqual([stream]);
            expect(legacyReads).toHaveLength(1);
        } finally {
            await page.context().close();
        }
    });

    test('keeps the previous instance cache visible and exportable as local activity', async ({
        browser,
        request,
    }) => {
        const page = await newServerPage(browser);
        const id = 'legacy-cache-source';
        const seeded = await request.put(
            `${STORAGE_BACKEND_URL}/v1/playlists/${id}`,
            {
                data: {
                    _id: id,
                    title: 'Legacy cache source',
                    serverUrl: 'https://unreachable.example.test',
                    username: 'legacy',
                    password: 'synthetic',
                },
            }
        );
        expect(seeded.ok()).toBe(true);
        const instance = await (
            await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
        ).json();
        await page.addInitScript(
            ({ instanceId, id }) => {
                localStorage.setItem(
                    `iptvnator-server:cache:${instanceId}:xtream-favorites`,
                    JSON.stringify({ [id]: ['movie:987654'] })
                );
                localStorage.setItem(
                    `iptvnator-server:cache:${instanceId}:xtream-collection-items`,
                    JSON.stringify({
                        [id]: {
                            'movie:987654': {
                                id: 987654,
                                xtream_id: 987654,
                                type: 'movie',
                                title: 'Preserved legacy favorite',
                                tmdb_id: 100,
                                release_year: 2000,
                            },
                        },
                    })
                );
            },
            { instanceId: instance.instanceId, id }
        );
        const activityRequests: string[] = [];
        page.on('request', (outgoing) => {
            if (outgoing.url().includes('/v1/user-state'))
                activityRequests.push(outgoing.method());
        });
        try {
            await page.goto('/workspace/global-favorites');
            await expect(
                page.getByRole('button', {
                    name: 'Preserved legacy favorite',
                    exact: true,
                })
            ).toBeVisible();
            await page.goto('/workspace/settings/backup');
            const downloading = page.waitForEvent('download');
            await page
                .getByRole('button', { name: 'Export', exact: true })
                .click();
            const path = await (await downloading).path();
            if (!path) throw new Error('Missing local backup');
            const exported = JSON.parse(await readFile(path, 'utf8'));
            expect(exported.playlists[0].userState.favorites[0]).toMatchObject({
                xtreamId: 987654,
                contentType: 'movie',
                snapshot: { title: 'Preserved legacy favorite' },
            });
            expect(activityRequests).toEqual([]);
        } finally {
            await page.context().close();
        }
    });

    test('imports browser sources explicitly without replacing the original profile', async ({
        browser,
        request,
    }) => {
        const page = await newServerPage(browser);
        await seedBrowserPlaylist(page, 'browser-only', 'Browser only');

        await page.goto('/workspace/sources');
        await expect(page.locator('mat-dialog-container')).toHaveCount(0);
        await expect(sourceRowByTitle(page, 'Browser only')).toHaveCount(0);
        await page.goto('/workspace/settings/server');
        await page.locator('[data-test-id="source-server-import"]').click();
        await expect(page.locator('app-settings-server-section li')).toHaveText(
            ['Browser only']
        );
        await page
            .locator('[data-test-id="source-server-import-confirm"]')
            .click();
        await expect(
            page.locator('[data-test-id="source-server-import-confirm"]')
        ).toBeHidden();
        const response = await request.get(
            `${STORAGE_BACKEND_URL}/v1/playlists?view=meta`
        );
        const metas = await response.json();
        expect(metas).toEqual([
            expect.objectContaining({ title: 'Browser only' }),
        ]);
        expect(metas[0]._id).not.toBe('browser-only');
        await openSources(page);
        await expect(sourceRowByTitle(page, 'Browser only')).toBeVisible();
        await page.context().close();
    });
    for (const existingServerActivity of [false, true])
        test(`durable Xtream backup snapshots stay local across shared source restore and explicit removal (existingServerActivity=${existingServerActivity})`, async ({
            browser,
            request,
        }) => {
            const first = await newServerPage(browser);
            const second = await newServerPage(browser);
            const playlistId = 'durable-server-favorite';
            const activityRequests: string[] = [];
            first.on('request', (request) => {
                if (new URL(request.url()).pathname.includes('/v1/user-state'))
                    activityRequests.push(request.method());
            });
            const manifest = {
                kind: 'iptvnator-playlist-backup',
                version: 1,
                exportedAt: new Date().toISOString(),
                includeSecrets: true,
                playlists: [
                    {
                        portalType: 'xtream',
                        exportedId: playlistId,
                        title: 'Server favorites',
                        autoRefresh: false,
                        connection: {
                            serverUrl: existingServerActivity
                                ? `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`
                                : 'https://offline.example.invalid',
                            username: existingServerActivity
                                ? 'user1'
                                : 'synthetic',
                            password: existingServerActivity
                                ? 'pass1'
                                : 'synthetic',
                        },
                        userState: {
                            hiddenCategories: [],
                            favorites: [
                                {
                                    xtreamId: 987655,
                                    contentType: 'movie',
                                    addedAt: '2020-01-01',
                                    position: 4,
                                    snapshot: {
                                        title: 'Saved server original',
                                        tmdbId: 100,
                                        releaseYear: 2000,
                                    },
                                },
                            ],
                            recentlyViewed: [],
                            playbackPositions: [],
                            collectionItems: [
                                {
                                    id: 987655,
                                    xtream_id: 987655,
                                    type: 'movie',
                                    title: 'Wrong cache replacement',
                                    tmdb_id: 200,
                                    release_year: 2026,
                                },
                            ],
                        },
                    },
                ],
            };
            if (existingServerActivity) {
                const source = await request.put(
                    `${STORAGE_BACKEND_URL}/v1/playlists/${playlistId}`,
                    {
                        data: {
                            _id: playlistId,
                            title: 'Server favorites',
                            ...manifest.playlists[0].connection,
                        },
                    }
                );
                expect(source.ok()).toBe(true);
                const seeded = await request.put(
                    `${STORAGE_BACKEND_URL}/v1/user-state/xtream-favorites/${playlistId}`,
                    {
                        data: { value: ['live:99'] },
                        headers: { 'If-None-Match': '*' },
                    }
                );
                expect(seeded.ok()).toBe(true);
            }
            try {
                if (!existingServerActivity)
                    await first.route(
                        (url) => url.pathname === '/xtream',
                        (route) => route.abort()
                    );
                if (!existingServerActivity)
                    await second.route(
                        (url) => url.pathname === '/xtream',
                        (route) => route.abort()
                    );
                await first.goto('/workspace/settings/backup');
                const chooser = first.waitForEvent('filechooser');
                await first
                    .getByRole('button', { name: 'Import', exact: true })
                    .click();
                await (
                    await chooser
                ).setFiles({
                    name: 'server-favorites.json',
                    mimeType: 'application/json',
                    buffer: Buffer.from(JSON.stringify(manifest)),
                });
                await expect(
                    first.getByText(
                        new RegExp('Backup import finished: .*0 failed')
                    )
                ).toBeVisible();
                const entries = (
                    await (
                        await request.get(
                            `${STORAGE_BACKEND_URL}/v1/user-state`
                        )
                    ).json()
                ).entries;
                expect(entries['xtream-favorites']).toEqual(
                    existingServerActivity ? { [playlistId]: ['live:99'] } : {}
                );
                expect(entries['xtream-collection-items']).toEqual({});
                await second.goto('/workspace/global-favorites');
                await expect(
                    second.getByRole('button', {
                        name: 'Saved server original',
                        exact: true,
                    })
                ).toHaveCount(0);
                // The source is shared, while the importing device owns its backup activity.
                await openSources(second);
                await expect(
                    sourceRowByTitle(second, 'Server favorites')
                ).toBeVisible();
                const downloading = first.waitForEvent('download');
                await first
                    .getByRole('button', { name: 'Export', exact: true })
                    .click();
                const path = await (await downloading).path();
                if (!path) throw new Error('Missing local backup');
                const exported = JSON.parse(await readFile(path, 'utf8'));
                expect(
                    exported.playlists[0].userState.favorites[0]
                ).toMatchObject(manifest.playlists[0].userState.favorites[0]);
                await first.goto('/workspace/global-favorites');
                await expect(
                    first.getByRole('button', {
                        name: 'Saved server original',
                        exact: true,
                    })
                ).toBeVisible();
                await first
                    .getByRole('button', {
                        name: 'Remove from favorites',
                        exact: true,
                    })
                    .click();
                await first.reload();
                await expect(
                    first.getByRole('button', {
                        name: 'Saved server original',
                        exact: true,
                    })
                ).toHaveCount(0);
                const retained = (
                    await (
                        await request.get(
                            `${STORAGE_BACKEND_URL}/v1/user-state`
                        )
                    ).json()
                ).entries;
                expect(retained).toEqual(entries);
                expect(activityRequests).toEqual([]);
            } finally {
                await first.context().close();
                await second.context().close();
            }
        });
});
