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
    // Both tests share one server database.
    test.describe.configure({ mode: 'serial' });

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
});
