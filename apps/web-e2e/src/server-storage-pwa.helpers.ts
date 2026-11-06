import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect } from './fixtures';
import {
    openSources,
    sourceRowByTitle,
    openSourceEditor,
    updateSourceDialog,
    saveSourceDialog,
} from './sources-pwa.helpers';

/** The storage-enabled backend from playwright.config.ts. */
export const STORAGE_BACKEND_URL = `http://localhost:${
    process.env['STORAGE_BACKEND_PORT'] ?? '3334'
}`;

/** A fresh browser profile (a "device") whose runtime config points at it. */
export async function newServerPage(browser: Browser): Promise<Page> {
    // Runtime configuration and instance replacement are routed by Playwright.
    // Real Service Worker coverage lives in pwa-styles.e2e.ts.
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('**/assets/app-config.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: ${JSON.stringify(STORAGE_BACKEND_URL)} };\n`,
        })
    );
    return page;
}

/** A legacy top-level parsed upload, written before the app boots. */
export async function seedBrowserPlaylist(
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
                        header: { attrs: {}, raw: '#EXTM3U' },
                        items: [
                            {
                                id: 'c1',
                                name: 'Channel',
                                url: 'https://example.invalid/c1.m3u8',
                            },
                        ],
                    });
                };
            }),
        [id, title] as const
    );
}

/** Editor regression: the writing client must replace its own parsed cache. */
export async function verifyEditedSourceChannels(
    browser: Browser,
    request: APIRequestContext
): Promise<void> {
    const page = await newServerPage(browser);
    const id = 'edited-url';
    const title = 'Editable shared URL';
    const provider = `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`;
    let channel = 'Original channel';
    await page.route(`${STORAGE_BACKEND_URL}/parse?*`, (route) =>
        route.fulfill({
            json: {
                header: { raw: '#EXTM3U', attrs: {} },
                items: [
                    {
                        name: channel,
                        url: `${provider}/${channel === 'Original channel' ? 'old' : 'new'}.ts`,
                    },
                ],
            },
        })
    );
    try {
        expect(
            (
                await request.put(`${STORAGE_BACKEND_URL}/v1/playlists/${id}`, {
                    data: {
                        _id: id,
                        title,
                        url: `${provider}/playlist.m3u`,
                        userAgent: 'original-agent',
                    },
                })
            ).ok()
        ).toBe(true);
        await openSources(page);
        await expect(sourceRowByTitle(page, title)).toBeVisible();
        const editor = await openSourceEditor(page, title);
        channel = 'Replacement channel';
        await updateSourceDialog(editor, { userAgent: 'replacement-agent' });
        await saveSourceDialog(editor);
        await sourceRowByTitle(page, title).click();
        await expect(
            page.locator('app-channel-list-item').filter({ hasText: channel })
        ).toBeVisible();
        await expect(
            page
                .locator('app-channel-list-item')
                .filter({ hasText: 'Original channel' })
        ).toHaveCount(0);
        await page.reload();
        await expect(
            page.locator('app-channel-list-item').filter({ hasText: channel })
        ).toBeVisible();
    } finally {
        await page.context().close();
    }
}

/** Hydration and folded form fields must retain the NAS-owned identity. */
export async function verifySharedStalkerIdentityEditing(
    browser: Browser,
    request: APIRequestContext
): Promise<void> {
    const page = await newServerPage(browser);
    const source = {
        id: 'shared-stalker-identity',
        title: 'Shared Stalker identity',
        kind: 'stalker',
        portalUrl: `http://localhost:${process.env['MOCK_PORT'] ?? '3210'}/portal.php`,
        macAddress: '00:1A:79:5F:AB:01',
        stalkerSerialNumber: 'SN-SYNC',
        stalkerDeviceId1: 'PINNED-SYNC-1',
        stalkerDeviceId2: 'PINNED-SYNC-2',
        stalkerSignature1: 'SIG-SYNC-1',
        stalkerSignature2: 'SIG-SYNC-2',
        username: 'sync-user',
        password: 'sync-password',
    };
    try {
        expect(
            (
                await request.put(
                    `${STORAGE_BACKEND_URL}/v1/sources/${source.id}`,
                    {
                        headers: { 'If-None-Match': '*' },
                        data: source,
                    }
                )
            ).ok()
        ).toBe(true);
        await openSources(page);
        const editor = await openSourceEditor(page, source.title);
        const disclosure = editor.locator('details');
        await expect(disclosure).toHaveAttribute('open', '');
        await expect(
            editor.locator('[formcontrolname="stalkerSerialNumber"]')
        ).toHaveValue(source.stalkerSerialNumber);
        await disclosure.locator('summary').click();
        await expect(
            editor.locator('[formcontrolname="password"]')
        ).toBeHidden();
        await updateSourceDialog(editor, { title: 'Renamed shared identity' });
        await saveSourceDialog(editor);
        const stored = await request.get(
            `${STORAGE_BACKEND_URL}/v1/sources/${source.id}`
        );
        expect(stored.ok()).toBe(true);
        expect(await stored.json()).toMatchObject({
            ...source,
            title: 'Renamed shared identity',
        });
    } finally {
        await page.context().close();
    }
}

/** An established browser may adopt an upload first created on another device. */
export async function verifyLegacyUploadedChannelIdentity(
    browser: Browser,
    request: APIRequestContext
): Promise<void> {
    const page = await newServerPage(browser);
    const id = 'legacy-shared-upload';
    try {
        expect(
            (
                await request.put(`${STORAGE_BACKEND_URL}/v1/sources/${id}`, {
                    headers: { 'If-None-Match': '*' },
                    data: {
                        id,
                        title: 'Legacy shared upload',
                        kind: 'm3u-text',
                        rawM3u: '#EXTM3U\n#EXTINF:-1,First\nhttps://media.test/same\n#EXTINF:-1,Second\nhttps://media.test/same',
                    },
                })
            ).ok()
        ).toBe(true);
        const { instanceId } = await (
            await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
        ).json();
        await page.addInitScript(
            (owner) =>
                localStorage.setItem('iptvnator-server:cache-owner', owner),
            instanceId
        );
        await openSources(page);
        await expect(
            sourceRowByTitle(page, 'Legacy shared upload')
        ).toBeVisible();
        const channels = await page.evaluate(
            ({ instanceId, id }) =>
                new Promise<{ id?: string; name: string }[]>(
                    (resolve, reject) => {
                        const opening = indexedDB.open(
                            `iptvnator-server:${instanceId}`
                        );
                        opening.onerror = () => reject(opening.error);
                        opening.onsuccess = () => {
                            const db = opening.result;
                            const reading = db
                                .transaction('playlists', 'readonly')
                                .objectStore('playlists')
                                .get(id);
                            reading.onerror = () => {
                                db.close();
                                reject(reading.error);
                            };
                            reading.onsuccess = () => {
                                db.close();
                                resolve(reading.result.playlist.items);
                            };
                        };
                    }
                ),
            { instanceId, id }
        );
        expect(channels.map((channel) => channel.name)).toEqual([
            'First',
            'Second',
        ]);
        expect(
            channels.every(
                (channel) => typeof channel.id === 'string' && channel.id
            )
        ).toBe(true);
        expect(new Set(channels.map((channel) => channel.id)).size).toBe(2);
    } finally {
        await page.context().close();
    }
}
