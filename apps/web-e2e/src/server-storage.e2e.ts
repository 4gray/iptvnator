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

    test('moves browser playlists to an empty server', async ({
        browser,
        request,
    }) => {
        const page = await newServerPage(browser);
        await seedBrowserPlaylist(page, 'browser-only', 'Browser only');

        await page.goto('/workspace/sources');
        const dialog = page.locator('mat-dialog-container');
        await expect(dialog).toContainText('Browser only');
        await dialog.locator('[data-test-id="server-migration-move"]').click();
        await expect(
            dialog.locator('[data-test-id="server-migration-reload"]')
        ).toBeVisible();

        const response = await request.get(
            `${STORAGE_BACKEND_URL}/v1/playlists?view=meta`
        );
        const metas = (await response.json()) as {
            _id: string;
            title: string;
        }[];
        expect(metas).toEqual([
            expect.objectContaining({
                _id: 'browser-only',
                title: 'Browser only',
            }),
        ]);

        // After the reload the library comes from the server.
        await dialog
            .locator('[data-test-id="server-migration-reload"]')
            .click();
        await expect(sourceRowByTitle(page, 'Browser only')).toBeVisible();
        await expect(page.locator('mat-dialog-container')).toHaveCount(0);

        await page.context().close();
    });
    for (const conflictingRestore of [false, true])
        test(`durable Xtream backup snapshots survive server restore, another device and explicit removal (conflict=${conflictingRestore})`, async ({
            browser,
            request,
        }) => {
            const first = await newServerPage(browser);
            const second = await newServerPage(browser);
            const playlistId = 'durable-server-favorite';
            let injected = false;
            await first.route(
                (url) =>
                    url.pathname ===
                    `/v1/user-state/xtream-favorites/${playlistId}`,
                async (route) => {
                    if (
                        conflictingRestore &&
                        !injected &&
                        route.request().method() === 'PUT'
                    ) {
                        injected = true;
                        const response = await request.put(
                            `${STORAGE_BACKEND_URL}/v1/user-state/xtream-favorites/${playlistId}`,
                            {
                                headers: { 'If-None-Match': '*' },
                                data: { value: ['live:99'] },
                            }
                        );
                        expect(response.ok()).toBe(true);
                    }
                    await route.continue();
                }
            );

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
                            serverUrl: conflictingRestore
                                ? `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`
                                : 'https://offline.example.invalid',
                            username: conflictingRestore
                                ? 'user1'
                                : 'synthetic',
                            password: conflictingRestore
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
            try {
                if (!conflictingRestore)
                    await first.route(
                        (url) => url.pathname === '/xtream',
                        (route) => route.abort()
                    );
                if (!conflictingRestore)
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
                        new RegExp(
                            `Backup import finished: .*${conflictingRestore ? 1 : 0} failed`
                        )
                    )
                ).toBeVisible();
                if (conflictingRestore) {
                    expect(injected).toBe(true);
                    await first.goto(`/workspace/xtreams/${playlistId}/vod`);
                    await expect
                        .poll(() =>
                            first.evaluate(
                                (id) =>
                                    localStorage.getItem(
                                        `xtream-restore-${id}`
                                    ),
                                playlistId
                            )
                        )
                        .toBeNull();
                }
                const entries = (
                    await (
                        await request.get(
                            `${STORAGE_BACKEND_URL}/v1/user-state`
                        )
                    ).json()
                ).entries;
                expect(Object.keys(entries['xtream-favorites'])).toEqual([
                    playlistId,
                ]);
                expect(entries['xtream-favorites'][playlistId]).toEqual([
                    'movie:987655',
                ]);
                expect(
                    entries['xtream-collection-items'][playlistId][
                        'movie:987655'
                    ]
                ).toMatchObject({
                    title: 'Saved server original',
                    tmdb_id: 100,
                    release_year: 2000,
                });
                await second.goto('/workspace/global-favorites');
                await expect(
                    second.getByRole('button', {
                        name: 'Saved server original',
                        exact: true,
                    })
                ).toBeVisible();
                await second.goto('/workspace/settings/backup');
                const downloading = second.waitForEvent('download');
                await second
                    .getByRole('button', { name: 'Export', exact: true })
                    .click();
                const path = await (await downloading).path();
                if (!path) throw new Error('Missing server backup');
                const exported = JSON.parse(await readFile(path, 'utf8'));
                expect(
                    exported.playlists[0].userState.favorites[0]
                ).toMatchObject(manifest.playlists[0].userState.favorites[0]);
                await second.goto('/workspace/global-favorites');
                await second
                    .getByRole('button', {
                        name: 'Remove from favorites',
                        exact: true,
                    })
                    .click();
                await expect
                    .poll(
                        async () =>
                            (
                                await (
                                    await request.get(
                                        `${STORAGE_BACKEND_URL}/v1/user-state`
                                    )
                                ).json()
                            ).entries['xtream-favorites'][playlistId]
                    )
                    .toEqual([]);
                await first.goto('/workspace/global-favorites');
                await first.reload();
                await expect(
                    first.getByRole('button', {
                        name: 'Saved server original',
                        exact: true,
                    })
                ).toHaveCount(0);
            } finally {
                await first.context().close();
                await second.context().close();
            }
        });
});
