import { test, expect } from '@playwright/test';
import { startSourceSyncServer } from './source-sync-test-server';
import {
    openSettings,
    openSettingsSection,
    openSources,
    sourceRowByTitle,
} from './electron-test-fixtures';

const frontendUrl = `http://localhost:${process.env['SOURCE_SYNC_WEB_PORT'] ?? '4317'}`;
test.skip(
    process.env['IPTVNATOR_E2E_SOURCE_SYNC'] !== '1',
    'Requires isolated source-sync configuration'
);

for (const enabled of [false, true])
    test(`persists the first offline favorite edit over HTTP without warm action chunks (sync=${enabled}) @m3u @web @persistence`, async ({
        browser,
    }) => {
        const server = await startSourceSyncServer();
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.addInitScript(() =>
            Object.defineProperty(crypto, 'subtle', { value: undefined })
        );
        const sourceId = 'synthetic-first-offline';
        const url = 'https://synthetic.invalid/first-offline';
        try {
            const { instanceId } = await (
                await fetch(`${server.apiUrl}/v1/instance`)
            ).json();
            expect(
                (
                    await fetch(`${server.apiUrl}/v1/sources/${sourceId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'If-None-Match': '*',
                            'X-IPTVnator-Instance-Id': instanceId,
                        },
                        body: JSON.stringify({
                            id: sourceId,
                            title: 'Synthetic first offline',
                            kind: 'm3u-text',
                            rawM3u: `#EXTM3U\n#EXTINF:-1,Synthetic first offline\n${url}`,
                        }),
                    })
                ).status
            ).toBe(201);
            const page = await context.newPage();
            await page.route('**/assets/app-config.js', (route) =>
                route.fulfill({
                    contentType: 'application/javascript',
                    body: `window.__IPTVNATOR_CONFIG__ = ${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
                })
            );
            await page.goto(`${frontendUrl}/workspace/sources`);
            if (enabled) {
                await openSettings(page);
                await openSettingsSection(page, 'server');
                await page
                    .getByTestId('favorites-sync-enabled')
                    .getByRole('checkbox')
                    .check();
                await expect(
                    page.getByTestId('favorites-sync-state')
                ).toContainText('Favorites synchronized');
            }
            const open = async () => {
                await openSources(page);
                await sourceRowByTitle(page, 'Synthetic first offline')
                    .getByText('Synthetic first offline', { exact: true })
                    .click();
                await expect(page.getByTestId('channel-item')).toHaveCount(1);
            };
            await open();
            await page.route('**/*.js', (route) => route.abort());
            await page.route(`${server.apiUrl}/v1/favorites/**`, (route) =>
                route.abort()
            );
            await page
                .getByTestId('channel-item')
                .locator('.favorite-button')
                .click();
            await expect
                .poll(() =>
                    page.evaluate(
                        ({ enabled, instanceId, sourceId, url }) =>
                            new Promise<boolean>((resolve, reject) => {
                                const request = indexedDB.open(
                                    enabled
                                        ? `iptvnator-favorites-v1:${instanceId}`
                                        : `iptvnator-server:${instanceId}`
                                );
                                request.onerror = () => reject(request.error);
                                request.onsuccess = () => {
                                    const db = request.result;
                                    const transaction = db.transaction(
                                        enabled ? 'records' : 'playlists',
                                        'readonly'
                                    );
                                    const rows = transaction
                                        .objectStore(
                                            enabled ? 'records' : 'playlists'
                                        )
                                        .getAll();
                                    transaction.oncomplete = () => {
                                        resolve(
                                            enabled
                                                ? rows.result.some(
                                                      (row) =>
                                                          row.pendingCount === 1
                                                  )
                                                : rows.result.some(
                                                      (row) =>
                                                          row._id ===
                                                              sourceId &&
                                                          row.favorites?.includes(
                                                              url
                                                          )
                                                  )
                                        );
                                        db.close();
                                    };
                                    transaction.onerror = () => {
                                        db.close();
                                        reject(transaction.error);
                                    };
                                };
                            }),
                        { enabled, instanceId, sourceId, url }
                    )
                )
                .toBe(true);
            const items = async () =>
                (
                    await (
                        await fetch(
                            `${server.apiUrl}/v1/favorites/sources/${sourceId}/items`,
                            {
                                headers: {
                                    'X-IPTVnator-Instance-Id': instanceId,
                                },
                            }
                        )
                    ).json()
                ).entries;
            expect(await items()).toHaveLength(0);
            await page.unroute('**/*.js');
            await page.unroute(`${server.apiUrl}/v1/favorites/**`);
            await page.reload();
            await open();
            await expect(
                page.getByTestId('channel-item').locator('.favorite-button')
            ).toHaveAttribute('aria-pressed', 'true');
            if (enabled)
                await expect
                    .poll(
                        async () =>
                            (await items()).filter(
                                (item: { state: { member: boolean } }) =>
                                    item.state.member
                            ).length
                    )
                    .toBe(1);
            else expect(await items()).toHaveLength(0);
        } finally {
            await context.close();
            await server.close();
        }
    });

test('persists the first offline Stalker removal after opening unified favorites directly @stalker @web @persistence', async ({
    browser,
}) => {
    const server = await startSourceSyncServer();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const sourceId = 'synthetic-offline-stalker';
    try {
        const { instanceId } = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        expect(
            (
                await fetch(`${server.apiUrl}/v1/sources/${sourceId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'If-None-Match': '*',
                        'X-IPTVnator-Instance-Id': instanceId,
                    },
                    body: JSON.stringify({
                        id: sourceId,
                        title: 'Synthetic offline Stalker source',
                        kind: 'stalker',
                        portalUrl: `http://localhost:${process.env['MOCK_PORT'] ?? '3417'}/portal.php`,
                        macAddress: '00:1A:79:12:34:56',
                    }),
                })
            ).status
        ).toBe(201);
        const page = await context.newPage();
        await page.route('**/assets/app-config.js', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `window.__IPTVNATOR_CONFIG__ = ${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
            })
        );
        let scriptsAvailable = true;
        await page.route('**/*.js', (route) =>
            scriptsAvailable ? route.fallback() : route.abort()
        );
        await page.goto(`${frontendUrl}/workspace/sources`);
        await expect(
            sourceRowByTitle(page, 'Synthetic offline Stalker source')
        ).toBeVisible();
        const localCount = (seed = false) =>
            page.evaluate(
                ({ instanceId, sourceId, seed }) =>
                    new Promise<number>((resolve, reject) => {
                        const request = indexedDB.open(
                            `iptvnator-server:${instanceId}`
                        );
                        request.onerror = () => reject(request.error);
                        request.onsuccess = () => {
                            const db = request.result;
                            const transaction = db.transaction(
                                'playlists',
                                seed ? 'readwrite' : 'readonly'
                            );
                            const store = transaction.objectStore('playlists');
                            const get = store.get(sourceId);
                            let count = -1;
                            get.onsuccess = () => {
                                const row = get.result;
                                if (seed) {
                                    row.favorites = [
                                        {
                                            id: '42',
                                            title: 'Synthetic offline movie',
                                            favoriteContentType: 'vod',
                                        },
                                    ];
                                    store.put(row);
                                }
                                count = row.favorites?.length ?? 0;
                            };
                            transaction.oncomplete = () => {
                                db.close();
                                resolve(count);
                            };
                            transaction.onerror = () => {
                                db.close();
                                reject(transaction.error);
                            };
                        };
                    }),
                { instanceId, sourceId, seed }
            );
        expect(await localCount(true)).toBe(1);
        await page.goto(`${frontendUrl}/workspace/global-favorites`);
        const remove = page.getByRole('button', {
            name: 'Remove from favorites',
            exact: true,
        });
        await expect(remove).toHaveCount(1);
        scriptsAvailable = false;
        await page.route(`${server.apiUrl}/v1/favorites/**`, (route) =>
            route.abort()
        );
        await remove.click();
        await expect.poll(() => localCount()).toBe(0);
        await expect(remove).toHaveCount(0);
        scriptsAvailable = true;
        await page.reload();
        await expect(remove).toHaveCount(0);
        expect(await localCount()).toBe(0);
    } finally {
        await context.close();
        await server.close();
    }
});
