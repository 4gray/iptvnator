import {
    STORAGE_BACKEND_URL,
    newServerPage,
    seedBrowserPlaylist,
    verifyEditedSourceChannels,
} from './server-storage-pwa.helpers';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import {
    addM3uUrlPlaylist,
    openSources,
    openSourceEditor,
    updateSourceDialog,
    sourceRowByTitle,
} from './sources-pwa.helpers';

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

        await first.locator('a[href="/workspace/sources"]').first().click();
        const editor = await openSourceEditor(first, 'Shared M3U');
        await updateSourceDialog(editor, { title: 'Renamed shared M3U' });
        await editor
            .locator('mat-dialog-actions')
            .getByRole('button', { name: 'Save', exact: true })
            .click();
        await expect(editor).toBeHidden();
        await expect(
            sourceRowByTitle(second, 'Renamed shared M3U')
        ).toBeVisible({ timeout: 25000 });

        await first.context().close();
        await second.context().close();
    });

    test('replaces the editing client channels after changing shared M3U request headers', async ({
        browser,
        request,
    }) => {
        await verifyEditedSourceChannels(browser, request);
    });

    test('opens the app and cached sources while URL materialization is pending', async ({
        browser,
        request,
    }) => {
        const page = await newServerPage(browser);
        const id = 'slow-projection';
        const title = 'Slow shared URL';
        const provider = `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`;
        const put = (url: string) =>
            request.put(`${STORAGE_BACKEND_URL}/v1/playlists/${id}`, {
                data: { _id: id, title, url },
            });
        expect((await put(`${provider}/playlist.m3u`)).ok()).toBe(true);
        let release!: () => void;
        let started!: () => void;
        let gate: Promise<void>;
        let providerStarted: Promise<void>;
        const hold = () => {
            gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            providerStarted = new Promise<void>((resolve) => {
                started = resolve;
            });
        };
        hold();
        await page.route(`${STORAGE_BACKEND_URL}/parse?*`, async (route) => {
            started();
            await gate;
            await route.fulfill({
                json: {
                    header: { raw: '#EXTM3U', attrs: {} },
                    items: [
                        {
                            name: 'Cached channel',
                            url: 'https://streams.test/live.ts',
                        },
                    ],
                },
            });
        });
        try {
            await page.goto('/workspace/sources');
            await providerStarted!;
            await page
                .locator('[data-test-id="source-sync-status"]')
                .getByRole('link', { name: 'Server', exact: true })
                .click();
            await expect(page).toHaveURL(/\/workspace\/settings\/server/);
            await expect(
                page.locator('app-settings-server-section')
            ).toBeVisible();
            release();
            await page.locator('a[href="/workspace/sources"]').first().click();
            await expect(sourceRowByTitle(page, title)).toBeVisible();
            expect((await put(`${provider}/changed.m3u`)).ok()).toBe(true);
            hold();
            await page.reload();
            await providerStarted!;
            await expect(sourceRowByTitle(page, title)).toBeVisible();
            await expect(
                page.getByRole('link', { name: 'Open settings', exact: true })
            ).toBeVisible();
            release();
        } finally {
            release();
            await page.context().close();
        }
    });

    test('keeps a newer disconnect from another tab when pending discovery recovers', async ({
        browser,
    }) => {
        const page = await newServerPage(browser);
        let offline = true;
        await page.route(`${STORAGE_BACKEND_URL}/v1/instance`, (route) =>
            offline ? route.abort('connectionfailed') : route.continue()
        );
        try {
            await page.goto('/workspace/sources');
            const status = page.locator('[data-test-id="source-sync-status"]');
            await expect(status).toContainText('Server unavailable');
            const sibling = await page.context().newPage();
            await sibling.route('**/__preferences__', (route) =>
                route.fulfill({
                    contentType: 'text/html',
                    body: '<!doctype html>',
                })
            );
            await sibling.goto('/__preferences__');
            await sibling.evaluate(() => {
                localStorage.removeItem('iptvnator:source-server');
                localStorage.setItem('iptvnator:source-server-disabled', '1');
            });
            offline = false;
            await page.bringToFront();
            await status
                .getByRole('button', { name: 'Refresh', exact: true })
                .click();
            await expect(status).toHaveCount(0);
            expect(
                await page.evaluate(() =>
                    localStorage.getItem('iptvnator:source-server')
                )
            ).toBeNull();
            expect(
                await page.evaluate(() =>
                    localStorage.getItem('iptvnator:source-server-disabled')
                )
            ).toBe('1');
        } finally {
            await page.context().close();
        }
    });

    test('withholds saved server and provider credentials after the instance is replaced', async ({
        browser,
        request,
    }) => {
        const page = await newServerPage(browser);
        const id = 'identity-guard';
        const title = 'Identity guarded source';
        expect(
            (
                await request.put(`${STORAGE_BACKEND_URL}/v1/playlists/${id}`, {
                    data: {
                        _id: id,
                        title,
                        serverUrl: `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`,
                        username: 'user1',
                        password: 'pass1',
                    },
                })
            ).ok()
        ).toBe(true);
        try {
            await openSources(page);
            await expect(sourceRowByTitle(page, title)).toBeVisible();
            await page.evaluate(
                (apiUrl) =>
                    sessionStorage.setItem(
                        `iptvnator:server-token:${JSON.stringify([apiUrl, JSON.parse(localStorage.getItem('iptvnator:source-server')!).instanceId])}`,
                        'synthetic-saved-secret'
                    ),
                STORAGE_BACKEND_URL
            );
            const probe = await (
                await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
            ).json();
            await page.route(`${STORAGE_BACKEND_URL}/v1/instance`, (route) =>
                route.fulfill({
                    json: { ...probe, instanceId: 'replacement-instance' },
                })
            );
            const outgoing: string[] = [];
            let identityRejected = false;
            page.on('request', (request) => {
                if (
                    identityRejected &&
                    request.url().startsWith(`${STORAGE_BACKEND_URL}/`) &&
                    !request.url().endsWith('/v1/instance')
                )
                    outgoing.push(request.url());
                if (request.url().endsWith('/v1/instance'))
                    expect(request.headers()['authorization']).toBeUndefined();
            });
            await page.bringToFront();
            const replaced = page.waitForResponse(
                `${STORAGE_BACKEND_URL}/v1/instance`
            );
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await replaced;
            const status = page.locator('[data-test-id="source-sync-status"]');
            await expect(status).toContainText('The server identity changed');
            // Background source-health calls may precede the identity response.
            // Observe new requests only after the rejection has been applied.
            identityRejected = true;
            await sourceRowByTitle(page, title).click();
            await expect(page.locator('app-playlist-error-view')).toBeVisible();
            expect(outgoing).toEqual([]);
            // A fresh boot with the cached library must verify identity before
            // an active portal can send anything to the replacement either.
            await page.reload();
            await expect(status).toContainText('The server identity changed');
            await expect(page.locator('app-playlist-error-view')).toBeVisible();
            expect(outgoing).toEqual([]);
        } finally {
            await page.context().close();
        }
    });

    for (const failure of ['instance-changed', 'network', 'gateway']) {
        test(`blocks provider credentials after a ${failure} source edit failure`, async ({
            browser,
            request,
        }) => {
            const page = await newServerPage(browser);
            const id = 'mutation-identity';
            const title = 'Mutation guarded source';
            expect(
                (
                    await request.put(
                        `${STORAGE_BACKEND_URL}/v1/playlists/${id}`,
                        {
                            data: {
                                _id: id,
                                title,
                                serverUrl: `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`,
                                username: 'user1',
                                password: 'pass1',
                            },
                        }
                    )
                ).ok()
            ).toBe(true);
            try {
                await openSources(page);
                const dialog = await openSourceEditor(page, title);
                await updateSourceDialog(dialog, { title: 'Rejected rename' });
                await page.evaluate(
                    (apiUrl) =>
                        sessionStorage.setItem(
                            `iptvnator:server-token:${JSON.stringify([apiUrl, JSON.parse(localStorage.getItem('iptvnator:source-server')!).instanceId])}`,
                            'synthetic-saved-secret'
                        ),
                    STORAGE_BACKEND_URL
                );
                const instance = await (
                    await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
                ).json();
                let replaced = false;
                await page.route(
                    `${STORAGE_BACKEND_URL}/v1/instance`,
                    (route) =>
                        replaced
                            ? route.fulfill({
                                  json: {
                                      ...instance,
                                      instanceId: 'replacement-instance',
                                  },
                              })
                            : route.continue()
                );
                await page.route(
                    `${STORAGE_BACKEND_URL}/v1/sources/${id}`,
                    (route) => {
                        if (route.request().method() !== 'PATCH')
                            return route.continue();
                        replaced = true;
                        if (failure === 'network') return route.abort('failed');
                        if (failure === 'gateway')
                            return route.fulfill({
                                status: 502,
                                contentType: 'text/html',
                                body: 'Gateway unavailable',
                            });
                        return route.fulfill({
                            status: 409,
                            json: { code: 'instance_changed' },
                        });
                    }
                );
                const outgoing: string[] = [];
                page.on('request', (request) => {
                    const url = new URL(request.url());
                    if (
                        url.origin === STORAGE_BACKEND_URL &&
                        ['/xtream', '/provider-targets'].includes(url.pathname)
                    )
                        outgoing.push(request.url());
                });
                await dialog
                    .locator('mat-dialog-actions')
                    .getByRole('button', { name: 'Save', exact: true })
                    .click();
                await expect(
                    page.locator('[data-test-id="source-sync-status"]')
                ).toContainText(
                    failure === 'instance-changed'
                        ? 'The server identity changed'
                        : 'Server unavailable'
                );
                expect(replaced).toBe(true);
                await dialog
                    .getByRole('button', { name: 'Close', exact: true })
                    .click();
                await expect(dialog).toBeHidden();
                await sourceRowByTitle(page, title).click();
                await expect(
                    page.locator('app-playlist-error-view')
                ).toBeVisible();
                expect(outgoing).toEqual([]);
            } finally {
                await page.context().close();
            }
        });
    }

    for (const transport of ['provider-targets', 'stalker']) {
        test(`blocks provider credentials after a ${transport} proxy outage reveals a replacement server`, async ({
            browser,
            request,
        }) => {
            const page = await newServerPage(browser);
            const title = `Outage guarded ${transport}`;
            const id = `outage-${transport}`;
            expect(
                (
                    await request.put(
                        `${STORAGE_BACKEND_URL}/v1/playlists/${id}`,
                        {
                            data: {
                                _id: id,
                                title,
                                portalUrl: `http://localhost:${process.env['MOCK_PORT'] ?? '3210'}/portal.php`,
                                macAddress: '00:1A:79:5F:00:02',
                            },
                        }
                    )
                ).ok()
            ).toBe(true);
            try {
                await openSources(page);
                const instance = await (
                    await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
                ).json();
                await page.evaluate(
                    ({ apiUrl, instanceId }) =>
                        sessionStorage.setItem(
                            `iptvnator:server-token:${JSON.stringify([apiUrl, instanceId])}`,
                            'synthetic-nas-secret'
                        ),
                    {
                        apiUrl: STORAGE_BACKEND_URL,
                        instanceId: instance.instanceId,
                    }
                );
                let outage = false;
                const laterProxyCalls: string[] = [];
                const probeTokens: Array<string | undefined> = [];
                await page.route(
                    `${STORAGE_BACKEND_URL}/v1/instance`,
                    (route) => {
                        probeTokens.push(
                            route.request().headers()['authorization']
                        );
                        return route.fulfill({
                            json: {
                                ...instance,
                                instanceId: outage
                                    ? 'replacement'
                                    : instance.instanceId,
                            },
                        });
                    }
                );
                await page.route(
                    `${STORAGE_BACKEND_URL}/${transport}*`,
                    (route) => {
                        outage = true;
                        return route.fulfill({
                            status: 502,
                            contentType: 'text/html',
                            body: 'Gateway unavailable',
                        });
                    }
                );
                page.on('request', (request) => {
                    const url = new URL(request.url());
                    if (
                        outage &&
                        url.origin === STORAGE_BACKEND_URL &&
                        ['/provider-targets', '/stalker'].includes(url.pathname)
                    )
                        laterProxyCalls.push(request.url());
                });
                await sourceRowByTitle(page, title).click();
                await expect.poll(() => outage).toBe(true);
                await expect(
                    page.locator('app-playlist-error-view')
                ).toBeVisible();
                // Re-check an edited connection without reloading the app or
                // discarding the failed request's in-memory verification state.
                await page
                    .locator('a[href="/workspace/sources"]')
                    .first()
                    .click();
                const dialog = await openSourceEditor(page, title);
                await updateSourceDialog(dialog, {
                    macAddress: '00:1A:79:5F:00:03',
                });
                await dialog
                    .locator('mat-dialog-actions')
                    .getByRole('button', { name: 'Save', exact: true })
                    .click();
                await expect.poll(() => probeTokens.length).toBeGreaterThan(0);
                expect(probeTokens.every((token) => token === undefined)).toBe(
                    true
                );
                expect(laterProxyCalls).toEqual([]);
            } finally {
                await page.context().close();
            }
        });
    }

    test('requires the new instance token after another tab replaces a connection at the same URL', async ({
        browser,
        request,
    }) => {
        const page = await newServerPage(browser);
        try {
            await openSources(page);
            const original = await (
                await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
            ).json();
            const replacement = {
                apiUrl: STORAGE_BACKEND_URL,
                instanceId: 'replacement-token-owner',
            };
            await page.evaluate(
                ({ apiUrl, originalId, replacement }) => {
                    sessionStorage.setItem(
                        `iptvnator:server-token:${JSON.stringify([apiUrl, originalId])}`,
                        'old-instance-secret'
                    );
                    // Another tab changes shared selection without changing this tab's session storage.
                    localStorage.setItem(
                        'iptvnator:source-server',
                        JSON.stringify(replacement)
                    );
                },
                {
                    apiUrl: STORAGE_BACKEND_URL,
                    originalId: original.instanceId,
                    replacement,
                }
            );
            await page.route(`${STORAGE_BACKEND_URL}/v1/instance`, (route) =>
                route.fulfill({
                    json: { ...original, instanceId: replacement.instanceId },
                })
            );
            const credentials: Array<string | undefined> = [];
            await page.route(`${STORAGE_BACKEND_URL}/v1/sources`, (route) => {
                if (route.request().method() !== 'GET') return route.continue();
                const authorization = route.request().headers()[
                    'authorization'
                ];
                credentials.push(authorization);
                const accepted = authorization === 'Bearer new-instance-token';
                return route.fulfill({
                    status: accepted ? 200 : 401,
                    headers: {
                        'Access-Control-Allow-Origin': new URL(page.url())
                            .origin,
                        'Access-Control-Expose-Headers': 'ETag',
                        ETag: '"replacement-library"',
                    },
                    json: accepted ? { entries: [] } : { code: 'unauthorized' },
                });
            });
            await page.reload();
            const status = page.locator('[data-test-id="source-sync-status"]');
            await expect(
                status.locator('input[type="password"]')
            ).toBeVisible();
            expect(credentials).toEqual([undefined]);
            await status
                .locator('input[type="password"]')
                .fill('new-instance-token');
            await status
                .getByRole('button', { name: 'Refresh', exact: true })
                .click();
            await expect(status).toHaveCount(0);
            expect(credentials).toEqual([
                undefined,
                'Bearer new-instance-token',
            ]);
        } finally {
            await page.context().close();
        }
    });

    test('updates sibling tabs after another tab projects a rename or deletion', async ({
        browser,
        request,
    }) => {
        const first = await newServerPage(browser);
        const id = 'sibling-tabs';
        const original = {
            _id: id,
            title: 'Shared in tabs',
            count: 1,
            playlist: {
                header: { raw: '#EXTM3U' },
                items: [
                    {
                        id: 'one',
                        name: 'Channel',
                        url: 'https://streams.example.test/live.ts',
                    },
                ],
            },
        };
        expect(
            (
                await request.put(`${STORAGE_BACKEND_URL}/v1/playlists/${id}`, {
                    data: original,
                })
            ).ok()
        ).toBe(true);
        try {
            await openSources(first);
            const second = await first.context().newPage();
            await openSources(second);
            await expect(
                sourceRowByTitle(second, original.title)
            ).toBeVisible();
            expect(
                (
                    await request.put(
                        `${STORAGE_BACKEND_URL}/v1/playlists/${id}`,
                        { data: { ...original, title: 'Renamed in tabs' } }
                    )
                ).ok()
            ).toBe(true);
            await first.evaluate(() =>
                window.dispatchEvent(new Event('focus'))
            );
            await expect(
                sourceRowByTitle(first, 'Renamed in tabs')
            ).toBeVisible();
            await second.evaluate(() =>
                window.dispatchEvent(new Event('focus'))
            );
            await expect(
                sourceRowByTitle(second, 'Renamed in tabs')
            ).toBeVisible();
            expect(
                (
                    await request.delete(
                        `${STORAGE_BACKEND_URL}/v1/playlists/${id}`
                    )
                ).ok()
            ).toBe(true);
            await first.evaluate(() =>
                window.dispatchEvent(new Event('focus'))
            );
            await expect(
                sourceRowByTitle(first, 'Renamed in tabs')
            ).toHaveCount(0);
            await second.evaluate(() =>
                window.dispatchEvent(new Event('focus'))
            );
            await expect(
                sourceRowByTitle(second, 'Renamed in tabs')
            ).toHaveCount(0);
        } finally {
            await first.context().close();
        }
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
            hiddenGroupTitles: ['Hidden legacy group'],
            manualEpgUrls: ['https://epg.example.test/manual.xml'],
            disabledEpgUrls: ['https://epg.example.test/disabled.xml'],
            detectedEpgUrls: [
                'https://epg.example.test/detected.xml',
                'https://epg.example.test/disabled.xml',
            ],
            epgUrls: [
                'https://epg.example.test/detected.xml',
                'https://epg.example.test/manual.xml',
            ],
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
            const migrated = await page.evaluate(
                ({ instanceId, id }) =>
                    new Promise<Record<string, unknown>>((resolve, reject) => {
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
                                resolve(reading.result);
                            };
                        };
                    }),
                { instanceId: instance.instanceId, id: m3uId }
            );
            expect(migrated).toMatchObject({
                hiddenGroupTitles: m3u.hiddenGroupTitles,
                manualEpgUrls: m3u.manualEpgUrls,
                disabledEpgUrls: m3u.disabledEpgUrls,
                detectedEpgUrls: m3u.detectedEpgUrls,
                epgUrls: m3u.epgUrls,
            });
            expect(m3uEntry.userState).toMatchObject({
                hiddenGroupTitles: m3u.hiddenGroupTitles,
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

    test('keeps a legacy pending Xtream restore authoritative in profile backup exports', async ({
        browser,
        request,
    }) => {
        const page = await newServerPage(browser);
        const id = 'legacy-parked-restore';
        expect(
            (
                await request.put(`${STORAGE_BACKEND_URL}/v1/playlists/${id}`, {
                    data: {
                        _id: id,
                        title: 'Parked restore',
                        serverUrl: 'https://unreachable.example.test',
                        username: 'legacy',
                        password: 'synthetic',
                    },
                })
            ).ok()
        ).toBe(true);
        const instance = await (
            await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
        ).json();
        await page.addInitScript(
            ({ instanceId, id }) => {
                localStorage.setItem(
                    'iptvnator-server:cache-owner',
                    instanceId
                );
                localStorage.setItem(
                    `xtream-restore-${id}`,
                    JSON.stringify({
                        hiddenCategories: [],
                        favorites: [
                            {
                                xtreamId: 987656,
                                contentType: 'movie',
                                snapshot: { title: 'Parked favorite' },
                            },
                        ],
                        recentlyViewed: [],
                        playbackPositions: [],
                    })
                );
            },
            { instanceId: instance.instanceId, id }
        );
        try {
            for (let attempt = 0; attempt < 2; attempt++) {
                await page.goto('/workspace/settings/backup');
                const downloading = page.waitForEvent('download');
                await page
                    .getByRole('button', { name: 'Export', exact: true })
                    .click();
                const path = await (await downloading).path();
                if (!path) throw new Error('Missing pending backup');
                const exported = JSON.parse(await readFile(path, 'utf8'));
                expect(exported.playlists[0].userState.favorites).toEqual([
                    expect.objectContaining({
                        xtreamId: 987656,
                        contentType: 'movie',
                        snapshot: { title: 'Parked favorite' },
                    }),
                ]);
                expect(
                    await page.evaluate(
                        ({ instanceId, id }) =>
                            localStorage.getItem(
                                `iptvnator-server:${instanceId}:xtream-restore-${id}`
                            ),
                        { instanceId: instance.instanceId, id }
                    )
                ).not.toBeNull();
                await page.reload();
            }
        } finally {
            await page.context().close();
        }
    });

    test('imports browser sources explicitly without replacing the original profile', async ({
        browser,
        request,
    }) => {
        const page = await newServerPage(browser);
        await page.addInitScript(() =>
            Object.defineProperty(crypto, 'randomUUID', {
                configurable: true,
                value: undefined,
            })
        );
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
