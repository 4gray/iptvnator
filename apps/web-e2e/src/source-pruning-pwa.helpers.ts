import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect } from './fixtures';
import {
    newServerPage,
    STORAGE_BACKEND_URL,
} from './server-storage-pwa.helpers';
import { openSources, sourceRowByTitle } from './sources-pwa.helpers';

async function cachedSource(
    page: Page,
    instanceId: string,
    id: string,
    write = false
) {
    return page.evaluate(
        ({ instanceId, id, write }) =>
            new Promise<{ favorites: string[] } | undefined>(
                (resolve, reject) => {
                    const opening = indexedDB.open(
                        `iptvnator-server:${instanceId}`
                    );
                    opening.onerror = () => reject(opening.error);
                    opening.onsuccess = () => {
                        const db = opening.result;
                        const tx = db.transaction(
                            'playlists',
                            write ? 'readwrite' : 'readonly'
                        );
                        const store = tx.objectStore('playlists');
                        const reading = store.get(id);
                        reading.onsuccess = () => {
                            if (write) {
                                reading.result.favorites = ['sibling-favorite'];
                                store.put(reading.result);
                            }
                        };
                        tx.oncomplete = () => {
                            db.close();
                            resolve(reading.result);
                        };
                        tx.onabort = tx.onerror = () => {
                            db.close();
                            reject(tx.error);
                        };
                    };
                }
            ),
        { instanceId, id, write }
    );
}

/** Shared IndexedDB across two tabs, with the HTTP-LAN Web Locks fallback. */
export async function verifyConcurrentSourcePruning(
    browser: Browser,
    request: APIRequestContext
) {
    const first = await newServerPage(browser);
    const context = first.context();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let started = false;
    await context.addInitScript(() =>
        Object.defineProperty(navigator, 'locks', { value: undefined })
    );
    await context.route('**/assets/app-config.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: ${JSON.stringify(STORAGE_BACKEND_URL)} };`,
        })
    );
    const parsed = { header: { raw: '#EXTM3U', attrs: {} }, items: [] };
    await first.route(`${STORAGE_BACKEND_URL}/parse?*`, async (route) => {
        started = true;
        await gate;
        await route.fulfill({ json: parsed });
    });
    try {
        expect(
            (
                await request.put(`${STORAGE_BACKEND_URL}/v1/sources/slow`, {
                    headers: { 'If-None-Match': '*' },
                    data: {
                        id: 'slow',
                        title: 'Slow original inventory',
                        kind: 'm3u-url',
                        url: `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}/playlist.m3u`,
                    },
                })
            ).ok()
        ).toBe(true);
        const { instanceId } = await (
            await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
        ).json();
        await first.goto('/workspace/sources');
        await expect.poll(() => started).toBe(true);
        expect(await first.evaluate(() => navigator.locks === undefined)).toBe(
            true
        );
        const second = await context.newPage();
        await second.route(`${STORAGE_BACKEND_URL}/parse?*`, (route) =>
            route.fulfill({ json: parsed })
        );
        await openSources(second);
        await expect(
            sourceRowByTitle(second, 'Slow original inventory')
        ).toBeVisible();
        const id = 'sibling-created';
        expect(
            (
                await request.put(`${STORAGE_BACKEND_URL}/v1/sources/${id}`, {
                    headers: { 'If-None-Match': '*' },
                    data: {
                        id,
                        title: 'Created in sibling',
                        kind: 'm3u-text',
                        rawM3u: '#EXTM3U\n#EXTINF:-1,New\nhttps://media.test/new',
                    },
                })
            ).ok()
        ).toBe(true);
        await second.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(
            sourceRowByTitle(second, 'Created in sibling')
        ).toBeVisible();
        await cachedSource(second, instanceId, id, true);
        release();
        await expect(first.getByTestId('source-sync-status')).toHaveCount(0);
        await expect(
            first.getByRole('button', { name: 'Add playlist', exact: true })
        ).toBeVisible();
        expect(await cachedSource(first, instanceId, id)).toMatchObject({
            favorites: ['sibling-favorite'],
        });
        await first.reload();
        await expect(
            sourceRowByTitle(first, 'Created in sibling')
        ).toBeVisible();
        expect(await cachedSource(first, instanceId, id)).toMatchObject({
            favorites: ['sibling-favorite'],
        });
    } finally {
        release();
        await context.close();
    }
}
