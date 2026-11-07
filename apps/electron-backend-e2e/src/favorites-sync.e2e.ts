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
    contentCardByTitle,
    clearCurrentUnifiedCollection,
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
async function verifyReceiverCategoryLock(page: Page, title: string) {
    await openSettings(page);
    await openSettingsSection(page, 'parental');
    const toggle = page.locator(
        '[data-test-id="parental-lock-enabled"] button[role="switch"]'
    );
    await toggle.click();
    await page.getByTestId('parental-lock-pin').fill('2468');
    await page.getByTestId('parental-lock-pin-confirm').fill('2468');
    await page.getByTestId('parental-lock-pin-submit').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await detail(page, 'xtream');
    await page.getByTestId('context-manage-categories').click();
    const dialog = page.locator('app-category-management-dialog');
    await dialog.locator('[data-test-id^="category-lock-"]').first().click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByTestId('header-parental-lock').click();
    await openGlobalFavorites(page);
    await expect(page.locator('app-empty-state')).toBeVisible();
    await expect(contentCardByTitle(page, title)).toHaveCount(0);
    await openSettings(page);
    await openSettingsSection(page, 'parental');
    await toggle.click();
    await page.getByTestId('parental-lock-pin').fill('2468');
    await page.getByTestId('parental-lock-pin-submit').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await openGlobalFavorites(page);
    await expect(contentCardByTitle(page, title)).toBeVisible();
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
                const receiverContext = await browser.newContext({
                    serviceWorkers: 'block',
                });
                try {
                    const receiver = await receiverContext.newPage();
                    await receiver.route('**/assets/app-config.js', (route) =>
                        route.fulfill({
                            contentType: 'application/javascript',
                            body: `window.__IPTVNATOR_CONFIG__ = ${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
                        })
                    );
                    await receiver.goto(`${frontendUrl}/workspace/sources`);
                    await routePlayableStreams(receiver);
                    await settings(receiver, true);
                    await openGlobalFavorites(receiver);
                    await expect(
                        contentCardByTitle(receiver, title!)
                    ).toBeVisible();
                    await startAndConfirmPlayback(
                        receiver,
                        async () => {
                            await receiver
                                .getByText(title!, { exact: true })
                                .first()
                                .click();
                            await receiver
                                .locator('[data-testid="vod-primary-action"]')
                                .click();
                        },
                        0.75
                    );
                } finally {
                    await receiverContext.close();
                }
                await verifyReceiverCategoryLock(desktop.mainWindow, title!);
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
                const seriesRow = (
                    await (
                        await fetch(
                            `http://localhost:${process.env['MOCK_PORT'] ?? '3417'}/portal.php?type=series&action=get_ordered_list&category=*&p=1`,
                            { headers: { cookie: 'mac=00:1a:79:00:00:07' } }
                        )
                    ).json()
                ).js.data[1];
                expect(seriesRow.cover).toBeTruthy();
                expect(seriesRow.description).toBeTruthy();
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
                                            kind: 'series',
                                            id: String(seriesRow.id),
                                            mode: 'regular',
                                        },
                                    },
                                    operation: {
                                        operationId:
                                            'synthetic-series-metadata',
                                        deviceId: 'fixture',
                                        expectedRevision: 0,
                                        member: true,
                                        snapshot: {
                                            title: 'Synthetic received series',
                                        },
                                    },
                                }),
                            }
                        )
                    ).status
                ).toBe(200);
                for (const client of [page, desktop.mainWindow]) {
                    await client.route('https://picsum.photos/**', (route) =>
                        route.fulfill({
                            contentType: 'image/svg+xml',
                            body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="#345"/></svg>',
                        })
                    );
                    await refresh(client);
                    await openGlobalFavorites(client);
                    await switchUnifiedCollectionContent(client, 'Series');
                    const card = contentCardByTitle(
                        client,
                        'Synthetic received series'
                    );
                    await expect(card.locator('img')).toHaveAttribute(
                        'src',
                        seriesRow.cover,
                        { timeout: 30000 }
                    );
                    await card.click();
                    await expect(
                        client.locator('.details__description')
                    ).toContainText(seriesRow.description, { timeout: 30000 });
                    await client
                        .getByRole('link', { name: 'Dashboard', exact: true })
                        .click();
                    const favorite = client
                        .getByTestId('dashboard-favorite-vod-rail')
                        .getByRole('listitem')
                        .filter({ hasText: 'Synthetic received series' });
                    await expect(favorite.locator('img')).toHaveAttribute(
                        'src',
                        seriesRow.cover,
                        { timeout: 30000 }
                    );
                }
                expect(JSON.stringify(await list())).not.toContain(
                    seriesRow.cover
                );
                expect(JSON.stringify(await list())).not.toContain(
                    seriesRow.description
                );
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
            if (provider === 'xtream') {
                const native = desktop.mainWindow;
                await openSources(native);
                await addXtreamPortal(native, {
                    name: 'Synthetic local source after opt-out',
                    username: 'marketing2',
                    password: 'marketing2',
                });
                const entries = (
                    await (await fetch(`${server.apiUrl}/v1/sources`)).json()
                ).entries;
                const id = entries.find(
                    (entry: { source: { title: string } }) =>
                        entry.source.title ===
                        'Synthetic local source after opt-out'
                )?.source.id;
                expect(id).toBeTruthy();
                await native.evaluate(async (id) => {
                    const restored =
                        await window.electron.dbRestoreXtreamFavorites(id, [
                            {
                                xtreamId: 99999990,
                                contentType: 'movie',
                                snapshot: {
                                    title: 'Synthetic local unlinked favorite',
                                },
                            },
                        ]);
                    if (!restored.success)
                        throw new Error('Synthetic favorite restore failed');
                    const [row] =
                        await window.electron.dbGetFavoritesForBackup(id);
                    if (row.id !== null || !row.favorite_id)
                        throw new Error(
                            'Expected a synthetic unlinked SQLite favorite'
                        );
                }, id);
                await openGlobalFavorites(native);
                const card = contentCardByTitle(
                    native,
                    'Synthetic local unlinked favorite'
                );
                await expect(card).toBeVisible();
                await card
                    .getByRole('button', { name: /remove from favorites/i })
                    .click();
                await expect(card).toHaveCount(0);
                expect(
                    await native.evaluate(
                        (id) => window.electron.dbGetFavoritesForBackup(id),
                        id
                    )
                ).toHaveLength(0);
                await openSources(native);
                await native.evaluate(async (id) => {
                    const result =
                        await window.electron.dbRestoreXtreamFavorites(id, [
                            {
                                xtreamId: 99999990,
                                contentType: 'movie',
                                snapshot: {
                                    title: 'Synthetic local unlinked favorite',
                                },
                            },
                            {
                                xtreamId: 99999991,
                                contentType: 'movie',
                                snapshot: {
                                    title: 'Synthetic second unlinked favorite',
                                },
                            },
                        ]);
                    if (!result.success)
                        throw new Error('Synthetic favorite restore failed');
                }, id);
                await openGlobalFavorites(native);
                await expect(
                    contentCardByTitle(
                        native,
                        'Synthetic second unlinked favorite'
                    )
                ).toBeVisible();
                await clearCurrentUnifiedCollection(native);
                expect(
                    await native.evaluate(
                        (id) => window.electron.dbGetFavoritesForBackup(id),
                        id
                    )
                ).toHaveLength(0);
            }
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
    const rawM3u =
        '#EXTM3U\n#EXTINF:-1,Synthetic first\nhttps://fixture.invalid/one\n#EXTINF:-1,Synthetic duplicate\nhttps://fixture.invalid/one\n#EXTINF:-1,Synthetic second\nhttps://fixture.invalid/two';
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
            buffer: Buffer.from(rawM3u),
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
                state: { member: boolean; revision: number };
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
        await page.setViewportSize({ width: 1280, height: 800 });
        const backupPath = join(directory, 'synthetic-favorites-backup.json');
        writeFileSync(
            backupPath,
            JSON.stringify({
                kind: 'iptvnator-playlist-backup',
                version: 1,
                exportedAt: new Date().toISOString(),
                includeSecrets: true,
                playlists: [
                    {
                        portalType: 'm3u',
                        exportedId: sourceId,
                        title: 'Synthetic favorites',
                        autoRefresh: false,
                        source: { kind: 'text', rawM3u },
                        userState: {
                            favorites: ['https://fixture.invalid/two'],
                            recentlyViewed: [],
                            hiddenGroupTitles: [],
                        },
                    },
                ],
            })
        );
        for (const [index, client] of [page, desktop.mainWindow].entries()) {
            for (const entry of (await list()).filter(
                (entry) => entry.state.member
            ))
                expect(
                    (
                        await fetch(
                            `${server.apiUrl}/v1/favorites/operations`,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-IPTVnator-Instance-Id': instanceId,
                                },
                                body: JSON.stringify({
                                    address: entry.address,
                                    operation: {
                                        operationId: `synthetic-backup-clear-${index}`,
                                        deviceId: 'fixture',
                                        expectedRevision: entry.state.revision,
                                        member: false,
                                    },
                                }),
                            }
                        )
                    ).status
                ).toBe(200);
            await settings(client, false);
            await open(client);
            const heart = client
                .getByTestId('channel-item')
                .nth(2)
                .locator('.favorite-button');
            if ((await heart.getAttribute('aria-pressed')) === 'true')
                await heart.click();
            await expect(heart).toHaveAttribute('aria-pressed', 'false');
            const serverBefore = JSON.stringify(await list());
            await openSettings(client);
            await openSettingsSection(client, 'backup');
            const chooser = client.waitForEvent('filechooser');
            await client
                .locator('#backup')
                .getByRole('button', { name: 'Import', exact: true })
                .click();
            await (await chooser).setFiles(backupPath);
            await expect(
                client.getByText(/Backup import finished: 0 imported, 1 merged/)
            ).toBeVisible({ timeout: 15000 });
            expect(JSON.stringify(await list())).toBe(serverBefore);
            await settings(client, true);
            await client.getByTestId('favorites-import-preview').click();
            await expect(
                client.getByTestId('favorites-sync-settings')
            ).toContainText('1 favorites from 1 sources. Unresolved: 0.');
            await client.getByTestId('favorites-import-confirm').click();
            await expect(
                client.getByTestId('favorites-use-local')
            ).toBeVisible();
            await client.getByTestId('favorites-use-local').click();
            await expect
                .poll(
                    async () =>
                        (await list()).filter((entry) => entry.state.member)
                            .length
                )
                .toBe(1);
        }
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await context.close();
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
