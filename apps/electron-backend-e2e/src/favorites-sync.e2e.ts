import {
    routePlayableStreams,
    startAndConfirmPlayback,
} from './playable-stream-fixture';
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSourceSyncServer } from './source-sync-test-server';
import {
    launchElectronApp,
    closeElectronApp,
    openSettings,
    openSettingsSection,
    openSources,
    sourceRowByTitle,
    addXtreamPortal,
    addStalkerPortal,
    waitForXtreamWorkspaceReady,
    waitForStalkerCatalog,
    openGlobalFavorites,
    switchUnifiedCollectionContent,
} from './electron-test-fixtures';
const frontendUrl = `http://localhost:${process.env['SOURCE_SYNC_WEB_PORT'] ?? '4317'}`;
test.skip(
    process.env['IPTVNATOR_E2E_SOURCE_SYNC'] !== '1',
    'Requires isolated source-sync configuration'
);
test.use({ actionTimeout: 20000, navigationTimeout: 30000 });
async function settings(page: Page, enabled?: boolean) {
    await openSettings(page);
    await openSettingsSection(page, 'server');
    if (enabled !== undefined)
        await page
            .getByTestId('favorites-sync-enabled')
            .getByRole('checkbox')
            .setChecked(enabled);
    if (enabled)
        await expect(page.getByTestId('favorites-sync-state')).toContainText(
            'Favorites synchronized',
            { timeout: 30000 }
        );
}
async function refresh(page: Page) {
    await settings(page);
    await page.getByTestId('favorites-sync-refresh').click();
}
async function detail(page: Page, provider: 'xtream' | 'stalker') {
    await openSources(page);
    await sourceRowByTitle(page, 'Synthetic shared favorites')
        .getByText('Synthetic shared favorites', { exact: true })
        .click();
    if (provider === 'xtream' && (await page.evaluate(() => !!window.electron)))
        await waitForXtreamWorkspaceReady(page);
    else if (provider === 'stalker') await waitForStalkerCatalog(page);
    await page.getByRole('link', { name: 'Movies', exact: true }).click();
    await page.locator('.category-item').first().click();
    const card = page
        .locator('.content-card__activation, app-grid-list mat-card')
        .first();
    await expect(card).toBeVisible();
    const title = await card.getAttribute('aria-label');
    await card.click();
    await expect(
        page
            .getByRole('button', {
                name: /add to favorites|remove from favorites/i,
            })
            .first()
    ).toBeVisible();
    return title;
}
for (const provider of ['xtream', 'stalker'] as const)
    test(`syncs synthetic ${provider} favorites across PWA and Electron with opt-in, removal and restart @persistence @web @electron`, async ({
        browser,
    }) => {
        const server = await startSourceSyncServer();
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.addInitScript(() =>
            Object.defineProperties(crypto, {
                randomUUID: { value: undefined },
                subtle: { value: undefined },
            })
        );
        const directory = mkdtempSync(
            join(tmpdir(), 'iptvnator-favorites-sync-')
        );
        let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
        try {
            const page = await context.newPage();
            let favoriteRequests = 0;
            page.on('request', (request) => {
                if (request.url().startsWith(`${server.apiUrl}/v1/favorites`))
                    favoriteRequests++;
            });
            await page.route('**/assets/app-config.js', (route) =>
                route.fulfill({
                    contentType: 'application/javascript',
                    body: `window.__IPTVNATOR_CONFIG__ = ${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
                })
            );
            await page.goto(`${frontendUrl}/workspace/sources`);
            if (provider === 'xtream')
                await addXtreamPortal(page, {
                    name: 'Synthetic shared favorites',
                    username: 'marketing',
                    password: 'marketing',
                });
            else
                await addStalkerPortal(page, {
                    name: 'Synthetic shared favorites',
                    macAddress: '00:1a:79:00:00:07',
                });
            const { instanceId } = await (
                await fetch(`${server.apiUrl}/v1/instance`)
            ).json();
            const inventory = await (
                await fetch(`${server.apiUrl}/v1/sources`)
            ).json();
            const sourceId = inventory.entries[0].source.id;
            const list = async () =>
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
                ).entries as { state: { member: boolean } }[];
            const title = await detail(page, provider);
            await page
                .getByRole('button', { name: /add to favorites/i })
                .first()
                .click();
            await expect(
                page
                    .getByRole('button', { name: /remove from favorites/i })
                    .first()
            ).toBeVisible();
            expect(await list()).toHaveLength(0);
            expect(favoriteRequests).toBe(0);
            await settings(page);
            await page
                .getByTestId('activity-sync-enabled')
                .getByRole('checkbox')
                .check();
            await expect(page.getByTestId('activity-sync-state')).toContainText(
                'Activity is synchronized',
                { timeout: 30000 }
            );
            expect(favoriteRequests).toBe(0);
            writeFileSync(
                join(directory, 'source-server.json'),
                JSON.stringify({ apiUrl: server.apiUrl, instanceId })
            );
            desktop = await launchElectronApp(directory);
            await settings(page, true);
            expect(await list()).toHaveLength(0);
            await settings(desktop.mainWindow, true);
            await openGlobalFavorites(desktop.mainWindow);
            await expect(
                desktop.mainWindow.getByRole('heading', {
                    name: 'No favorites yet',
                    exact: true,
                })
            ).toBeVisible();
            await page.getByTestId('favorites-import-preview').click();
            await expect(
                page.getByTestId('favorites-import-confirm')
            ).toBeEnabled();
            await page.getByTestId('favorites-import-confirm').click();
            await expect
                .poll(
                    async () =>
                        (await list()).filter((entry) => entry.state.member)
                            .length
                )
                .toBe(1);
            await expect(
                desktop.mainWindow.getByText(title!, { exact: true }).first()
            ).toBeVisible({ timeout: 30000 });
            if (provider === 'xtream') {
                for (const client of [page, desktop.mainWindow]) {
                    await routePlayableStreams(client);
                    await detail(client, provider);
                    await openGlobalFavorites(client);
                    // Keep the original media element through a full poll,
                    // including a loop of the short deterministic fixture.
                    await startAndConfirmPlayback(
                        client,
                        async () => {
                            await client
                                .getByText(title!, { exact: true })
                                .first()
                                .click();
                            await client
                                .locator('[data-testid="vod-primary-action"]')
                                .click();
                        },
                        2.5
                    );
                    const media = await client
                        .locator('video')
                        .first()
                        .elementHandle();
                    if (!media)
                        throw new Error('Synthetic playback element missing');
                    const startedAt = await media.evaluate((element) => {
                        (element as HTMLVideoElement).loop = true;
                        return performance.now();
                    });
                    await expect
                        .poll(
                            () =>
                                media.evaluate((element, start) => {
                                    const video = element as HTMLVideoElement;
                                    return (
                                        video.isConnected &&
                                        !video.paused &&
                                        video.readyState >= 2 &&
                                        performance.now() - start >= 6500
                                    );
                                }, startedAt),
                            { timeout: 15000 }
                        )
                        .toBe(true);
                    await media.dispose();
                }
            }
            await detail(page, provider);
            await expect(
                page
                    .getByRole('button', { name: /remove from favorites/i })
                    .first()
            ).toBeVisible();
            await detail(desktop.mainWindow, provider);
            await desktop.mainWindow
                .getByRole('button', { name: /remove from favorites/i })
                .first()
                .click();
            await expect
                .poll(
                    async () =>
                        (await list()).filter((entry) => entry.state.member)
                            .length
                )
                .toBe(0);
            await expect(
                page.getByRole('button', { name: /add to favorites/i }).first()
            ).toBeVisible({ timeout: 30000 });
            await settings(page, false);
            await detail(page, provider);
            await page
                .getByRole('button', { name: /add to favorites/i })
                .first()
                .click();
            expect(
                (await list()).filter((entry) => entry.state.member)
            ).toHaveLength(0);
            await expect(
                page
                    .getByRole('button', { name: /remove from favorites/i })
                    .first()
            ).toBeVisible();
            await page.reload();
            await detail(page, provider);
            await expect(
                page
                    .getByRole('button', { name: /remove from favorites/i })
                    .first()
            ).toBeVisible();
            await closeElectronApp(desktop);
            desktop = await launchElectronApp(directory);
            await refresh(desktop.mainWindow);
            expect(
                (await list()).filter((entry) => entry.state.member)
            ).toHaveLength(0);
            if (provider === 'stalker') {
                const headers = {
                    'Content-Type': 'application/json',
                    'X-IPTVnator-Instance-Id': instanceId,
                };
                const scope = await (
                    await fetch(
                        `${server.apiUrl}/v1/favorites/sources/${sourceId}`,
                        { headers }
                    )
                ).json();
                // A receiving device has never archived these provider rows or commands.
                for (const [type, kind] of [
                    ['vod', 'movie'],
                    ['itv', 'live'],
                    ['radio', 'radio'],
                ] as const) {
                    const rows = (
                        await (
                            await fetch(
                                `http://localhost:${process.env['MOCK_PORT'] ?? '3417'}/portal.php?type=${type}&action=get_ordered_list&category=*&p=1`,
                                { headers: { cookie: 'mac=00:1a:79:00:00:07' } }
                            )
                        ).json()
                    ).js.data;
                    const row = rows.filter(
                        (value: { is_series?: unknown; series?: unknown[] }) =>
                            !value.is_series && !value.series?.length
                    )[1];
                    expect(row).toBeDefined();
                    const title = `Synthetic remote ${kind}`;
                    expect(
                        (
                            await fetch(
                                `${server.apiUrl}/v1/favorites/operations`,
                                {
                                    method: 'POST',
                                    headers,
                                    body: JSON.stringify({
                                        address: {
                                            instanceId,
                                            scope: 'shared',
                                            sourceId,
                                            sourceIncarnation:
                                                scope.sourceIncarnation,
                                            content: {
                                                provider: 'stalker',
                                                kind,
                                                id: String(row.id),
                                            },
                                        },
                                        operation: {
                                            operationId: `synthetic-remote-${kind}`,
                                            deviceId: 'fixture',
                                            expectedRevision: 0,
                                            member: true,
                                            snapshot: { title },
                                        },
                                    }),
                                }
                            )
                        ).status
                    ).toBe(200);
                }
                await settings(page, true);
                for (const client of [page, desktop.mainWindow]) {
                    await routePlayableStreams(client);
                    for (const kind of ['movie', 'live', 'radio']) {
                        await refresh(client);
                        await openGlobalFavorites(client);
                        await switchUnifiedCollectionContent(
                            client,
                            kind === 'movie' ? 'Movies' : 'Live TV'
                        );
                        await startAndConfirmPlayback(
                            client,
                            async () => {
                                await client
                                    .getByText(`Synthetic remote ${kind}`, {
                                        exact: true,
                                    })
                                    .first()
                                    .click();
                                if (kind === 'movie')
                                    await client
                                        .locator(
                                            '[data-testid="vod-primary-action"]'
                                        )
                                        .click();
                            },
                            0.75
                        );
                    }
                }
                expect(JSON.stringify(await list())).not.toContain('cmd');
                for (const [index, mode] of [
                    'regular',
                    'embedded',
                    'lazy',
                ].entries()) {
                    const response = await fetch(
                        `${server.apiUrl}/v1/favorites/operations`,
                        {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({
                                address: {
                                    instanceId,
                                    scope: 'shared',
                                    sourceId,
                                    sourceIncarnation: scope.sourceIncarnation,
                                    content: {
                                        provider: 'stalker',
                                        kind: 'series',
                                        id: String(9001 + index),
                                        mode,
                                    },
                                },
                                operation: {
                                    operationId: 'synthetic-' + mode,
                                    deviceId: 'fixture',
                                    expectedRevision: 0,
                                    member: true,
                                    snapshot: {
                                        title: `Synthetic ${mode} series`,
                                        ...(mode === 'embedded'
                                            ? { episodes: [1, 2] }
                                            : {}),
                                    },
                                },
                            }),
                        }
                    );
                    expect(response.status).toBe(200);
                }
                await settings(page, true);
                for (const client of [page, desktop.mainWindow]) {
                    await refresh(client);
                    await openGlobalFavorites(client);
                    await switchUnifiedCollectionContent(client, 'Movies');
                    await expect(
                        client
                            .getByText('Synthetic embedded series', {
                                exact: true,
                            })
                            .first()
                    ).toBeVisible();
                    await switchUnifiedCollectionContent(client, 'Series');
                    await expect(
                        client
                            .getByText('Synthetic regular series', {
                                exact: true,
                            })
                            .first()
                    ).toBeVisible();
                    await expect(
                        client
                            .getByText('Synthetic lazy series', { exact: true })
                            .first()
                    ).toBeVisible();
                }
                await settings(page, false);
            }
            await settings(desktop.mainWindow, false);
        } finally {
            if (desktop) await closeElectronApp(desktop);
            await context.close();
            await server.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

test('syncs duplicate-URL M3U membership, offline conflicts and independent adds; renders narrow settings in both themes @m3u @web @electron @persistence @settings', async ({
    browser,
}, testInfo) => {
    const server = await startSourceSyncServer();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(() =>
        Object.defineProperties(crypto, {
            randomUUID: { value: undefined },
            subtle: { value: undefined },
        })
    );
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-favorites-m3u-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        const page = await context.newPage();
        await page.route('**/assets/app-config.js', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `window.__IPTVNATOR_CONFIG__ = ${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
            })
        );
        await page.goto(`${frontendUrl}/workspace/sources`);
        await page
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        const dialog = page.locator('mat-dialog-container');
        await dialog.getByRole('radio', { name: /file/i }).click();
        await dialog.locator('input[type="file"]').setInputFiles({
            name: 'Synthetic favorites.m3u',
            mimeType: 'audio/x-mpegurl',
            buffer: Buffer.from(
                '#EXTM3U\n#EXTINF:-1,Synthetic first\nhttps://fixture.invalid/one\n#EXTINF:-1,Synthetic duplicate\nhttps://fixture.invalid/one\n#EXTINF:-1,Synthetic second\nhttps://fixture.invalid/two'
            ),
        });
        await dialog.getByRole('button', { name: /add playlist/i }).click();
        await expect(dialog).toHaveCount(0);
        const { instanceId } = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        const inventory = await (
            await fetch(`${server.apiUrl}/v1/sources`)
        ).json();
        const sourceId = inventory.entries[0].source.id;
        const list = async () =>
            (
                await (
                    await fetch(
                        `${server.apiUrl}/v1/favorites/sources/${sourceId}/items`,
                        { headers: { 'X-IPTVnator-Instance-Id': instanceId } }
                    )
                ).json()
            ).entries as {
                address: { content: unknown };
                state: { member: boolean };
            }[];
        const open = async (client: Page) => {
            await openSources(client);
            await sourceRowByTitle(client, 'Synthetic favorites')
                .getByText('Synthetic favorites', { exact: true })
                .click();
            await expect(client.getByTestId('channel-item')).toHaveCount(3);
        };
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({ apiUrl: server.apiUrl, instanceId })
        );
        desktop = await launchElectronApp(directory);
        await settings(page, true);
        await settings(desktop.mainWindow, true);
        await open(page);
        await page
            .getByTestId('channel-item')
            .nth(0)
            .locator('.favorite-button')
            .click();
        await expect
            .poll(
                async () =>
                    (await list()).filter((entry) => entry.state.member).length
            )
            .toBe(1);
        await expect(
            page.getByTestId('channel-item').nth(1).locator('.favorite-button')
        ).toHaveAttribute('aria-pressed', 'true');
        expect(JSON.stringify((await list())[0].address)).not.toContain(
            'fixture.invalid'
        );
        await refresh(desktop.mainWindow);
        await open(desktop.mainWindow);
        await expect(
            desktop.mainWindow
                .getByTestId('channel-item')
                .nth(1)
                .locator('.favorite-button')
        ).toHaveAttribute('aria-pressed', 'true');
        await page.route(`${server.apiUrl}/v1/favorites/operations`, (route) =>
            route.fulfill({ status: 503, body: 'Synthetic delivery outage' })
        );
        await page
            .getByTestId('channel-item')
            .nth(2)
            .locator('.favorite-button')
            .click();
        await refresh(page);
        await expect(page.getByTestId('favorites-sync-state')).toContainText(
            'Server or local storage unavailable',
            { timeout: 30000 }
        );
        await page.unroute(`${server.apiUrl}/v1/favorites/operations`);
        await refresh(page);
        await expect(page.getByTestId('favorites-sync-state')).toContainText(
            'Favorites synchronized'
        );
        await open(page);
        await page
            .getByTestId('channel-item')
            .nth(2)
            .locator('.favorite-button')
            .click();
        await expect
            .poll(
                async () =>
                    (await list()).filter((entry) => entry.state.member).length
            )
            .toBe(1);
        await page.route(`${server.apiUrl}/v1/favorites/**`, (route) =>
            route.abort()
        );
        await desktop.mainWindow
            .getByTestId('channel-item')
            .nth(0)
            .locator('.favorite-button')
            .click();
        await expect
            .poll(
                async () =>
                    (await list()).filter((entry) => entry.state.member).length
            )
            .toBe(0);
        await page
            .getByTestId('channel-item')
            .nth(0)
            .locator('.favorite-button')
            .click();
        await page
            .getByTestId('channel-item')
            .nth(2)
            .locator('.favorite-button')
            .click();
        await expect
            .poll(() =>
                page.evaluate(
                    (id) =>
                        new Promise<number>((resolve, reject) => {
                            const open = indexedDB.open(
                                `iptvnator-favorites-v1:${id}`,
                                1
                            );
                            open.onerror = () => reject(open.error);
                            open.onsuccess = () => {
                                const db = open.result;
                                const tx = db.transaction(
                                    'records',
                                    'readonly'
                                );
                                const rows = tx.objectStore('records').getAll();
                                tx.oncomplete = () => {
                                    resolve(
                                        rows.result.reduce(
                                            (count, row) =>
                                                count + row.pendingCount,
                                            0
                                        )
                                    );
                                    db.close();
                                };
                                tx.onerror = () => {
                                    db.close();
                                    reject(tx.error);
                                };
                            };
                        }),
                    instanceId
                )
            )
            .toBe(2);
        await page.unroute(`${server.apiUrl}/v1/favorites/**`);
        await refresh(page);
        await expect(page.getByTestId('favorites-keep-server')).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.favorites-conflict').scrollIntoViewIfNeeded();
        await page.screenshot({
            path: testInfo.outputPath('settings-favorites-conflict-narrow.png'),
            fullPage: true,
            animations: 'disabled',
        });
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.getByTestId('favorites-keep-server').click();
        await expect
            .poll(
                async () =>
                    (await list()).filter((entry) => entry.state.member).length
            )
            .toBe(1);
        await refresh(desktop.mainWindow);
        await open(desktop.mainWindow);
        await expect(
            desktop.mainWindow
                .getByTestId('channel-item')
                .nth(0)
                .locator('.favorite-button')
        ).toHaveAttribute('aria-pressed', 'false');
        await expect(
            desktop.mainWindow
                .getByTestId('channel-item')
                .nth(2)
                .locator('.favorite-button')
        ).toHaveAttribute('aria-pressed', 'true');
        await settings(page);
        await page
            .locator('form.settings-layout')
            .evaluate((form) =>
                form.addEventListener('submit', () =>
                    form.setAttribute('data-unexpected-submit', 'true')
                )
            );
        await page.getByTestId('favorites-sync-refresh').click();
        await expect(page.locator('form.settings-layout')).not.toHaveAttribute(
            'data-unexpected-submit',
            'true'
        );
        await page.setViewportSize({ width: 390, height: 900 });
        const backdrop = page.getByTestId('context-drawer-backdrop');
        if (await backdrop.isVisible()) await backdrop.click();
        const surfaces: string[] = [];
        for (const dark of [false, true]) {
            await page.evaluate(
                (dark) => document.body.classList.toggle('dark-theme', dark),
                dark
            );
            await page
                .getByTestId('favorites-sync-settings')
                .scrollIntoViewIfNeeded();
            expect(
                await page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <=
                        window.innerWidth
                )
            ).toBe(true);
            surfaces.push(
                await page
                    .getByTestId('favorites-sync-settings')
                    .locator('.settings-card')
                    .evaluate(
                        (element) => getComputedStyle(element).backgroundColor
                    )
            );
            await expect
                .poll(
                    async () =>
                        (
                            await page
                                .getByTestId('favorites-sync-settings')
                                .locator('h2')
                                .boundingBox()
                        )?.x ?? -1
                )
                .toBeGreaterThanOrEqual(0);
            await page.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(
                    `settings-favorites-${dark ? 'dark' : 'light'}-narrow.png`
                ),
            });
        }
        expect(surfaces[0]).not.toBe(surfaces[1]);
        await page
            .getByTestId('favorites-sync-enabled')
            .getByRole('checkbox')
            .uncheck();
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await context.close();
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
