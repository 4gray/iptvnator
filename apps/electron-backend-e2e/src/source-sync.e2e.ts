import { setSourceStateWriteFailure } from './source-sync-sqlite-fault';
import { test, expect, type Page } from '@playwright/test';
import {
    mkdtempSync,
    rmSync,
    writeFileSync,
    unlinkSync,
    readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    closeElectronApp,
    launchElectronApp,
    openSources,
    addXtreamPortal,
    addStalkerPortal,
    waitForXtreamWorkspaceReady,
    waitForStalkerCatalog,
    resetMockServers,
    openSettings,
    openSettingsSection,
    openWorkspaceSection,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';
import {
    routePlayableStreams,
    startAndConfirmPlayback,
} from './playable-stream-fixture';

const frontendUrl = `http://localhost:${process.env['SOURCE_SYNC_WEB_PORT'] ?? '4307'}`;

test.skip(
    process.env['IPTVNATOR_E2E_SOURCE_SYNC'] !== '1',
    'Run with playwright.source-sync.config.ts'
);

async function browserClient(page: Page, apiUrl: string, token = '') {
    await page.route('**/assets/app-config.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.__IPTVNATOR_CONFIG__ = ${JSON.stringify({ BACKEND_URL: apiUrl })};`,
        })
    );
    if (token) {
        const { instanceId } = await (
            await fetch(`${apiUrl}/v1/instance`)
        ).json();
        await page.addInitScript(
            ({ apiUrl, instanceId, token }) =>
                sessionStorage.setItem(
                    `iptvnator:server-token:${JSON.stringify([apiUrl, instanceId])}`,
                    token
                ),
            { apiUrl, instanceId, token }
        );
    }
    await page.goto(`${frontendUrl}/workspace/sources`);
    await expect(
        page.getByRole('button', { name: 'Add playlist', exact: true })
    ).toBeVisible();
}

async function addTextSource(page: Page, title: string) {
    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    const dialog = page.locator('mat-dialog-container');
    await dialog.getByRole('radio', { name: /file/i }).click();
    await dialog.locator('input[type="file"]').setInputFiles({
        name: `${title}.m3u`,
        mimeType: 'audio/x-mpegurl',
        buffer: Buffer.from(
            `#EXTM3U\n#EXTINF:-1,${title}\nhttps://streams.example.test/shared.ts`
        ),
    });
    await dialog
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    await expect(dialog).toBeHidden();
}

for (const failReceipt of [false, true]) {
    test(`finishes interrupted first synchronization with remotely deleted cached rows (receipt failure: ${failReceipt}) @electron @persistence`, async ({
        request,
    }) => {
        const server = await startSourceSyncServer();
        const directory = mkdtempSync(
            join(tmpdir(), 'iptvnator-sync-incomplete-')
        );
        const source = {
            id: 'interrupted',
            title: 'Interrupted cache',
            kind: 'm3u-text',
            rawM3u: '#EXTM3U\n#EXTINF:-1,Channel\nhttps://streams.example.test/live',
        };
        let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
        try {
            const created = await request.put(
                `${server.apiUrl}/v1/sources/${source.id}`,
                { headers: { 'If-None-Match': '*' }, data: source }
            );
            expect(created.ok()).toBe(true);
            const instance = await (
                await request.get(`${server.apiUrl}/v1/instance`)
            ).json();
            writeFileSync(
                join(directory, 'source-server.json'),
                JSON.stringify({
                    apiUrl: server.apiUrl,
                    instanceId: instance.instanceId,
                })
            );
            desktop = await launchElectronApp(directory);
            await openSources(desktop.mainWindow);
            await expect(
                desktop.mainWindow
                    .getByText(source.title, { exact: true })
                    .first()
            ).toBeVisible();
            await desktop.mainWindow.evaluate(async (id) => {
                await window.electron.dbSetAppState(
                    'parental-lock:locks',
                    JSON.stringify({
                        [id]: { xtream: [], stalker: [], m3u: ['Private'] },
                    })
                );
                await window.electron.dbSetAppState(
                    'source-sync-initialized',
                    ''
                );
            }, source.id);
            if (failReceipt)
                await setSourceStateWriteFailure(
                    desktop.electronApp,
                    directory,
                    instance.instanceId,
                    true,
                    'source-sync-initialized'
                );
            await closeElectronApp(desktop);
            desktop = undefined;
            expect(
                (
                    await request.delete(
                        `${server.apiUrl}/v1/sources/${source.id}`,
                        { headers: { 'If-Match': created.headers()['etag'] } }
                    )
                ).ok()
            ).toBe(true);
            desktop = await launchElectronApp(directory);
            const page = desktop.mainWindow;
            if (failReceipt) {
                await expect(
                    page.getByTestId('source-sync-status')
                ).toContainText('Server unavailable');
                await setSourceStateWriteFailure(
                    desktop.electronApp,
                    directory,
                    instance.instanceId,
                    false,
                    'source-sync-initialized'
                );
                await page
                    .getByTestId('source-sync-status')
                    .getByRole('button', { name: 'Refresh', exact: true })
                    .click();
            }
            await expect(page.getByTestId('source-sync-status')).toHaveCount(
                0,
                {
                    timeout: 25000,
                }
            );
            await openSources(page);
            await expect(
                page.getByText(source.title, { exact: true })
            ).toHaveCount(0);
            expect(
                await page.evaluate(() =>
                    window.electron.dbGetAppState('source-sync-initialized')
                )
            ).toBe('1');
            expect(
                JSON.parse(
                    (await page.evaluate(() =>
                        window.electron.dbGetAppState('parental-lock:locks')
                    ))!
                )
            ).toEqual({});
        } finally {
            if (desktop) await closeElectronApp(desktop);
            await server.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
}

test('shares source changes between independent PWA and Electron clients @critical @web @electron @m3u', async ({
    browser,
}) => {
    const server = await startSourceSyncServer();
    const context = await browser.newContext();
    const second = await browser.newContext();
    const desktopDir = mkdtempSync(join(tmpdir(), 'iptvnator-sync-desktop-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        const first = await context.newPage();
        const other = await second.newPage();
        const errors: string[] = [];
        first.on('pageerror', (error) => errors.push(error.message));
        await browserClient(first, server.apiUrl);
        await browserClient(other, server.apiUrl);
        await addTextSource(first, 'NAS shared upload');
        await expect(
            other.getByText('NAS shared upload', { exact: true }).first()
        ).toBeVisible({ timeout: 25000 });
        await routePlayableStreams(other);
        await other
            .getByText('NAS shared upload', { exact: true })
            .first()
            .click();
        await startAndConfirmPlayback(other, () =>
            other.locator('app-channel-list-item').first().click()
        );
        await openSources(other);
        const instance = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        writeFileSync(
            join(desktopDir, 'source-server.json'),
            JSON.stringify({
                apiUrl: server.apiUrl,
                instanceId: instance.instanceId,
            })
        );
        desktop = await launchElectronApp(desktopDir);
        desktop.mainWindow.on('pageerror', (error) =>
            errors.push(`desktop: ${error.message}`)
        );
        await expect(
            desktop.mainWindow.getByRole('link', {
                name: 'Sources',
                exact: true,
            })
        ).toBeVisible({ timeout: 45000 });
        await openSources(desktop.mainWindow);
        await expect(
            desktop.mainWindow
                .getByText('NAS shared upload', { exact: true })
                .first()
        ).toBeVisible({ timeout: 25000 });
        await addTextSource(desktop.mainWindow, 'Desktop shared upload');
        await expect(
            other.getByText('Desktop shared upload', { exact: true }).first()
        ).toBeVisible({ timeout: 25000 });
        const inventory = await (
            await fetch(`${server.apiUrl}/v1/sources`)
        ).json();
        const entry = inventory.entries.find(
            (value: { source: { title: string } }) =>
                value.source.title === 'NAS shared upload'
        );
        await other
            .getByRole('main')
            .getByRole('button', { name: 'NAS shared upload', exact: true })
            .click();
        await expect(
            other.locator('app-channel-list-item').first()
        ).toContainText('NAS shared upload');
        const renamed = await fetch(
            `${server.apiUrl}/v1/sources/${entry.source.id}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'If-Match': entry.revision,
                },
                body: JSON.stringify({
                    ...entry.source,
                    kind: 'm3u-text',
                    rawM3u: '#EXTM3U\n#EXTINF:-1,Renamed channel\nhttps://streams.example.test/shared.ts',
                    title: 'Renamed on NAS',
                }),
            }
        );
        expect(renamed.status).toBe(200);
        await expect(
            other.locator('app-channel-list-item').first()
        ).toContainText('Renamed channel', { timeout: 25000 });
        await expect(other.locator('app-channel-list-item')).toHaveCount(1);
        expect(other.url()).toContain(
            `/workspace/playlists/${entry.source.id}`
        );
        await expect(
            other.getByText('Renamed on NAS', { exact: true }).first()
        ).toBeVisible({ timeout: 25000 });
        const deleted = await fetch(
            `${server.apiUrl}/v1/sources/${entry.source.id}`,
            {
                method: 'DELETE',
                headers: { 'If-Match': renamed.headers.get('etag')! },
            }
        );
        expect(deleted.status).toBe(200);
        await expect(
            other.getByText('Renamed on NAS', { exact: true })
        ).toHaveCount(0, { timeout: 25000 });
        await expect
            .poll(
                () =>
                    desktop!.mainWindow.evaluate(
                        async (id) =>
                            !!(await window.electron.dbGetPlaylist(id)),
                        entry.source.id
                    ),
                { timeout: 25000 }
            )
            .toBe(false);
        await expect(
            desktop.mainWindow.evaluate(
                (id) =>
                    window.electron.dbCreatePlaylist({
                        id,
                        name: 'Late session',
                        type: 'stalker',
                    }),
                entry.source.id
            )
        ).rejects.toThrow('Shared source no longer exists');
        expect(errors).toEqual([]);
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await context.close();
        await second.close();
        await server.close();
        rmSync(desktopDir, { recursive: true, force: true });
    }
});

test('restores the original Electron library after disconnect despite an inherited NAS profile @electron @m3u', async () => {
    const server = await startSourceSyncServer();
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-sync-disconnect-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        desktop = await launchElectronApp(directory);
        await openSources(desktop.mainWindow);
        await addTextSource(desktop.mainWindow, 'Original desktop source');
        await closeElectronApp(desktop);
        desktop = undefined;
        const instance = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({
                apiUrl: server.apiUrl,
                instanceId: instance.instanceId,
            })
        );
        desktop = await launchElectronApp(directory);
        await openSources(desktop.mainWindow);
        await expect(
            desktop.mainWindow.getByText('Original desktop source', {
                exact: true,
            })
        ).toHaveCount(0);
        await addTextSource(desktop.mainWindow, 'NAS desktop source');
        const inheritedProfile = await desktop.electronApp.evaluate(
            () => process.env['IPTVNATOR_SOURCE_PROFILE']!
        );
        await closeElectronApp(desktop);
        desktop = undefined;
        // app.relaunch inherits the old process environment after disconnect.
        unlinkSync(join(directory, 'source-server.json'));
        desktop = await launchElectronApp(directory, {
            env: { IPTVNATOR_SOURCE_PROFILE: inheritedProfile },
        });
        await openSources(desktop.mainWindow);
        await expect(
            desktop.mainWindow
                .getByText('Original desktop source', { exact: true })
                .first()
        ).toBeVisible();
        await expect(
            desktop.mainWindow.getByText('NAS desktop source', { exact: true })
        ).toHaveCount(0);
        expect(
            await desktop.electronApp.evaluate(
                () => process.env['IPTVNATOR_SOURCE_PROFILE']
            )
        ).toBeUndefined();
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('authenticates the PWA and retains its isolated source cache while NAS is offline @web @m3u', async ({
    browser,
}) => {
    const token = 'synthetic-instance-token';
    const server = await startSourceSyncServer(token);
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        await page.route('**/assets/app-config.js', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `window.__IPTVNATOR_CONFIG__ = ${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
            })
        );
        await page.goto(`${frontendUrl}/workspace/sources`);
        const status = page.locator('app-source-sync-status');
        await status.getByLabel('Access token (optional)').fill(token);
        await status
            .getByRole('button', { name: 'Refresh', exact: true })
            .click();
        await expect(
            page.getByRole('button', { name: 'Add playlist', exact: true })
        ).toBeVisible();
        await addTextSource(page, 'Authenticated NAS source');
        await openSources(page);
        await expect(
            page.getByText('Authenticated NAS source', { exact: true }).first()
        ).toBeVisible();
        expect(
            await page.evaluate(() =>
                localStorage.getItem('iptvnator:source-server')
            )
        ).not.toContain(token);
        const userState = await fetch(`${server.apiUrl}/v1/user-state`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(await userState.json()).toEqual({
            entries: {
                'xtream-favorites': {},
                'xtream-recent-items': {},
                'xtream-collection-items': {},
                'xtream-playback-positions': {},
            },
            tags: {
                'xtream-favorites': {},
                'xtream-recent-items': {},
                'xtream-collection-items': {},
                'xtream-playback-positions': {},
            },
        });
        await server.close();
        await page.reload();
        await expect(status).toContainText('Server unavailable', {
            timeout: 25000,
        });
        await expect(
            page.getByText('Authenticated NAS source', { exact: true }).first()
        ).toBeVisible();
    } finally {
        await context.close();
        await server.close();
    }
});

test('opens shared Xtream and Stalker sources on PWA and independent Electron profiles @web @electron @xtream @stalker', async ({
    browser,
    request,
}, testInfo) => {
    await resetMockServers(request, ['xtream', 'stalker']);
    const server = await startSourceSyncServer();
    const context = await browser.newContext();
    const directories = [
        mkdtempSync(join(tmpdir(), 'iptvnator-sync-provider-')),
        mkdtempSync(join(tmpdir(), 'iptvnator-sync-replica-')),
    ];
    const apps: Array<Awaited<ReturnType<typeof launchElectronApp>>> = [];
    try {
        const page = await context.newPage();
        await browserClient(page, server.apiUrl);
        await addXtreamPortal(page, { name: 'NAS Xtream' });
        await expect(page.locator('.category-item').first()).toBeVisible({
            timeout: 25000,
        });
        await expect(
            page.locator('app-grid-list mat-card').first()
        ).toBeVisible({ timeout: 25000 });
        const instance = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        for (const directory of directories)
            writeFileSync(
                join(directory, 'source-server.json'),
                JSON.stringify({
                    apiUrl: server.apiUrl,
                    instanceId: instance.instanceId,
                })
            );
        const desktop = await launchElectronApp(directories[0]);
        apps.push(desktop);
        await openSources(desktop.mainWindow);
        await desktop.mainWindow
            .getByText('NAS Xtream', { exact: true })
            .first()
            .click();
        await waitForXtreamWorkspaceReady(desktop.mainWindow);
        await routePlayableStreams(desktop.mainWindow);
        await openWorkspaceSection(desktop.mainWindow, 'Live TV');
        await desktop.mainWindow.locator('.category-item').first().click();
        await startAndConfirmPlayback(desktop.mainWindow, () =>
            desktop.mainWindow.getByTestId('channel-item').first().click()
        );
        await addStalkerPortal(desktop.mainWindow, { name: 'NAS Stalker' });
        await waitForStalkerCatalog(desktop.mainWindow);

        await openSources(page);
        await expect(
            page.getByText('NAS Stalker', { exact: true }).first()
        ).toBeVisible({ timeout: 25000 });
        await page.getByText('NAS Stalker', { exact: true }).first().click();
        await waitForStalkerCatalog(page);
        await routePlayableStreams(page);
        await page.getByRole('link', { name: /live|itv/i }).click();
        await expect(page.locator('.category-item').first()).toBeVisible();
        await page.locator('.category-item').first().click();
        await startAndConfirmPlayback(page, () =>
            page.getByTestId('channel-item').first().click()
        );

        const replica = await launchElectronApp(directories[1]);
        apps.push(replica);
        await openSources(replica.mainWindow);
        await expect(
            replica.mainWindow.getByText('NAS Xtream', { exact: true }).first()
        ).toBeVisible();
        await replica.mainWindow
            .getByText('NAS Stalker', { exact: true })
            .first()
            .click();
        await waitForStalkerCatalog(replica.mainWindow);
        const inventory = await (
            await fetch(`${server.apiUrl}/v1/sources`)
        ).json();
        expect(inventory.entries).toHaveLength(2);
        expect(JSON.stringify(inventory)).not.toContain('stalkerToken');
        const sharedStalker = inventory.entries.find(
            (entry: { source: { kind: string } }) =>
                entry.source.kind === 'stalker'
        );
        const changedMac = '02:00:00:00:00:02';
        const refreshedSession = page.waitForRequest(
            (request) => {
                const url = new URL(request.url());
                return (
                    url.pathname.endsWith('/stalker') &&
                    url.searchParams.get('macAddress') === changedMac
                );
            },
            { timeout: 25000 }
        );
        const changedConnection = await fetch(
            `${server.apiUrl}/v1/sources/${sharedStalker.source.id}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'If-Match': sharedStalker.revision,
                },
                body: JSON.stringify({
                    ...sharedStalker.source,
                    macAddress: changedMac,
                }),
            }
        );
        expect(changedConnection.status).toBe(200);
        await refreshedSession;

        await openSettings(page);
        await openSettingsSection(page, 'server');
        await expect(page.getByTestId('source-server-state')).toContainText(
            'Connected'
        );
        await page.screenshot({
            path: testInfo.outputPath('server-settings-desktop.png'),
            fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
            path: testInfo.outputPath('server-settings-mobile.png'),
            fullPage: true,
        });
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth
            )
        ).toBe(true);
    } finally {
        for (const app of apps.reverse()) await closeElectronApp(app);
        await context.close();
        await server.close();
        for (const directory of directories)
            rmSync(directory, { recursive: true, force: true });
    }
});

test('imports original browser sources once and returns to the preserved local library @web @m3u', async ({
    browser,
}) => {
    const server = await startSourceSyncServer();
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        await page.route('**/assets/app-config.js', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: 'window.__IPTVNATOR_CONFIG__ = {};',
            })
        );
        await page.goto(`${frontendUrl}/workspace/sources`);
        await addTextSource(page, 'Retained local source');
        const instance = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        await page.evaluate(
            (connection) =>
                localStorage.setItem(
                    'iptvnator:source-server',
                    JSON.stringify(connection)
                ),
            { apiUrl: server.apiUrl, instanceId: instance.instanceId }
        );
        await page.reload();
        await openSources(page);
        await expect(
            page.getByText('Retained local source', { exact: true })
        ).toHaveCount(0);
        await openSettings(page);
        await openSettingsSection(page, 'server');
        await page.getByTestId('source-server-import').click();
        await expect(page.locator('app-settings-server-section li')).toHaveText(
            ['Retained local source']
        );
        await page.getByTestId('source-server-import-confirm').click();
        await expect(
            page.getByTestId('source-server-import-confirm')
        ).toBeHidden();
        await page.getByTestId('source-server-import').click();
        await page.getByTestId('source-server-import-confirm').click();
        await expect(
            page.getByTestId('source-server-import-confirm')
        ).toBeHidden();
        const inventory = await (
            await fetch(`${server.apiUrl}/v1/sources`)
        ).json();
        expect(inventory.entries).toHaveLength(1);
        await page
            .getByRole('button', { name: 'Disconnect', exact: true })
            .click();
        await expect(page.getByTestId('source-server-connect')).toBeVisible();
        await openSources(page);
        await expect(
            page.getByText('Retained local source', { exact: true }).first()
        ).toBeVisible();
        expect(
            (await (await fetch(`${server.apiUrl}/v1/sources`)).json()).entries
        ).toHaveLength(1);
    } finally {
        await context.close();
        await server.close();
    }
});

test('keeps standalone pending favorites out of a server profile with the same source ID @electron @xtream @persistence', async ({
    request,
}) => {
    const server = await startSourceSyncServer();
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-sync-pending-'));
    const id = 'archive-collision';
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        expect(
            (
                await request.put(`${server.apiUrl}/v1/playlists/${id}`, {
                    data: {
                        _id: id,
                        title: 'Isolated server source',
                        serverUrl: 'https://provider.example.invalid',
                        username: 'user',
                        password: 'synthetic',
                    },
                })
            ).ok()
        ).toBe(true);
        const instance = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({
                apiUrl: server.apiUrl,
                instanceId: instance.instanceId,
            })
        );
        desktop = await launchElectronApp(directory);
        let page = desktop.mainWindow;
        await openSources(page);
        await expect(
            page.getByText('Isolated server source', { exact: true }).first()
        ).toBeVisible();
        const archive = JSON.stringify({
            favorites: [{ contentType: 'movie', xtreamId: 42 }],
            favoritesRestoreId: 'standalone-archive',
        });
        await page.evaluate(
            ({ id, archive }) =>
                localStorage.setItem(`xtream-restore-${id}`, archive),
            { id, archive }
        );
        await closeElectronApp(desktop);
        desktop = undefined;
        desktop = await launchElectronApp(directory);
        page = desktop.mainWindow;
        await openSources(page);
        expect(
            await page.evaluate(
                (id) => localStorage.getItem(`xtream-restore-${id}`),
                id
            )
        ).toBe(archive);
        await openWorkspaceSection(page, 'Global favorites');
        await expect(
            page.getByRole('heading', { name: 'No favorites yet', exact: true })
        ).toBeVisible();
        expect(
            await page.evaluate(() => window.electron.dbGetAllGlobalFavorites())
        ).toEqual([]);
        expect(
            await page.evaluate(
                (id) => localStorage.getItem(`xtream-restore-${id}`),
                id
            )
        ).toBe(archive);
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('recovers from a truncated native connection without opening the original library @electron @persistence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-sync-recovery-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        desktop = await launchElectronApp(directory);
        await openSources(desktop.mainWindow);
        await addTextSource(desktop.mainWindow, 'Preserved standalone source');
        await closeElectronApp(desktop);
        desktop = undefined;
        const path = join(directory, 'source-server.json');
        writeFileSync(path, '{truncated');
        desktop = await launchElectronApp(directory);
        const page = desktop.mainWindow;
        await expect(
            page.getByTestId('source-connection-recovery')
        ).toBeVisible();
        await expect(
            page.getByText('Preserved standalone source', { exact: true })
        ).toHaveCount(0);
        expect(
            await page.evaluate(() => window.electron.dbGetAppPlaylists())
        ).toEqual([]);
        expect(readFileSync(path, 'utf8')).toBe('{truncated');
        await page
            .getByTestId('source-connection-recovery')
            .getByRole('link')
            .click();
        await expect(page.getByTestId('source-server-connect')).toBeVisible();
        // Keep the restart under the fixture's process ownership.
        await desktop.electronApp.evaluate(({ app }) => {
            app.relaunch = () => undefined;
            app.exit = () => undefined;
        });
        await page
            .getByRole('button', { name: 'Disconnect', exact: true })
            .click();
        await closeElectronApp(desktop);
        desktop = undefined;
        desktop = await launchElectronApp(directory);
        await openSources(desktop.mainWindow);
        await expect(
            desktop.mainWindow
                .getByText('Preserved standalone source', { exact: true })
                .first()
        ).toBeVisible();
        await expect(
            desktop.mainWindow.getByTestId('source-connection-recovery')
        ).toHaveCount(0);
    } finally {
        if (desktop) await closeElectronApp(desktop);
        rmSync(directory, { recursive: true, force: true });
    }
});

for (const failCleanup of [false, true]) {
    test(`removes native parental locks after remote deletion and ID reuse (failedCleanup=${failCleanup}) @electron @persistence`, async ({
        request,
    }) => {
        const server = await startSourceSyncServer();
        const directory = mkdtempSync(join(tmpdir(), 'iptvnator-sync-locks-'));
        const source = {
            id: 'remote-locked-source',
            title: 'Remote locked source',
            kind: 'm3u-text',
            rawM3u: '#EXTM3U\n#EXTINF:-1 group-title="Private",Channel\nhttps://streams.example.test/shared.ts',
        };
        let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
        try {
            const created = await request.put(
                `${server.apiUrl}/v1/sources/${source.id}`,
                { headers: { 'If-None-Match': '*' }, data: source }
            );
            expect(created.ok()).toBe(true);
            const instance = await (
                await request.get(`${server.apiUrl}/v1/instance`)
            ).json();
            writeFileSync(
                join(directory, 'source-server.json'),
                JSON.stringify({
                    apiUrl: server.apiUrl,
                    instanceId: instance.instanceId,
                })
            );
            desktop = await launchElectronApp(directory);
            await openSources(desktop.mainWindow);
            await expect(
                desktop.mainWindow
                    .getByText(source.title, { exact: true })
                    .first()
            ).toBeVisible();
            await desktop.mainWindow.evaluate(
                (id) =>
                    window.electron.dbSetAppState(
                        'parental-lock:locks',
                        JSON.stringify({
                            [id]: { xtream: [], stalker: [], m3u: ['Private'] },
                        })
                    ),
                source.id
            );
            await closeElectronApp(desktop);
            desktop = undefined;
            desktop = await launchElectronApp(directory);
            let page = desktop.mainWindow;
            await openSources(page);
            await expect(
                page.getByText(source.title, { exact: true }).first()
            ).toBeVisible({ timeout: 25000 });
            expect(
                JSON.parse(
                    (await page.evaluate(() =>
                        window.electron.dbGetAppState('parental-lock:locks')
                    ))!
                )
            ).toHaveProperty(source.id);
            if (failCleanup)
                await setSourceStateWriteFailure(
                    desktop.electronApp,
                    directory,
                    instance.instanceId,
                    true
                );
            const deleted = await request.delete(
                `${server.apiUrl}/v1/sources/${source.id}`,
                { headers: { 'If-Match': created.headers()['etag'] } }
            );
            expect(deleted.ok()).toBe(true);
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            if (failCleanup) {
                await expect
                    .poll(() =>
                        page.evaluate(
                            (id) => window.electron.dbGetAppPlaylist(id),
                            source.id
                        )
                    )
                    .toBeNull();
                expect(
                    JSON.parse(
                        (await page.evaluate(() =>
                            window.electron.dbGetAppState('parental-lock:locks')
                        ))!
                    )
                ).toHaveProperty(source.id);
                await closeElectronApp(desktop);
                desktop = undefined;
                desktop = await launchElectronApp(directory);
                page = desktop.mainWindow;
                await openSources(page);
                await setSourceStateWriteFailure(
                    desktop.electronApp,
                    directory,
                    instance.instanceId,
                    false
                );
                await page.evaluate(() =>
                    window.dispatchEvent(new Event('focus'))
                );
            }
            await expect(
                page.getByText(source.title, { exact: true })
            ).toHaveCount(0, { timeout: 25000 });
            await expect
                .poll(async () =>
                    JSON.parse(
                        (await page.evaluate(() =>
                            window.electron.dbGetAppState('parental-lock:locks')
                        ))!
                    )
                )
                .toEqual({});
            expect(
                (
                    await request.put(
                        `${server.apiUrl}/v1/sources/${source.id}`,
                        {
                            headers: { 'If-None-Match': '*' },
                            data: source,
                        }
                    )
                ).ok()
            ).toBe(true);
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await expect(
                page.getByText(source.title, { exact: true }).first()
            ).toBeVisible({ timeout: 25000 });
            expect(
                JSON.parse(
                    (await page.evaluate(() =>
                        window.electron.dbGetAppState('parental-lock:locks')
                    ))!
                )
            ).toEqual({});
        } finally {
            if (desktop) await closeElectronApp(desktop);
            await server.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
}
