import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    if (token)
        await page.addInitScript(
            ({ apiUrl, token }) =>
                sessionStorage.setItem(
                    `iptvnator:server-token:${apiUrl}`,
                    token
                ),
            { apiUrl, token }
        );
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
