import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startSourceSyncServer } from './source-sync-test-server';
import {
    launchElectronApp,
    closeElectronApp,
    openSettings,
    openSettingsSection,
    openSources,
    sourceRowByTitle,
    openGlobalRecent,
    clearCurrentUnifiedCollection,
} from './electron-test-fixtures';
import {
    routePlayableStreams,
    startAndConfirmPlayback,
} from './playable-stream-fixture';
const frontend = `http://localhost:${process.env['SOURCE_SYNC_WEB_PORT'] ?? '4327'}`;
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
            .getByTestId('history-sync-enable')
            .getByRole('checkbox')
            .setChecked(enabled);
    if (enabled)
        await expect(
            page.getByTestId('history-sync-settings').getByRole('status')
        ).toContainText(/synchronized|synchronis/i, { timeout: 30000 });
}
test('shares confirmed synthetic M3U history and preserves import, ordering, clear and opt-out across runtimes @history @web @electron @persistence', async ({
    browser,
}, testInfo) => {
    const server = await startSourceSyncServer();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-history-mixed-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        const page = await context.newPage();
        await page.route('**/assets/app-config.js', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `window.__IPTVNATOR_CONFIG__=${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
            })
        );
        await routePlayableStreams(page);
        await page.goto(`${frontend}/workspace/sources`);
        await page
            .getByRole('button', { name: 'Add playlist', exact: true })
            .click();
        const dialog = page.locator('mat-dialog-container');
        await dialog.getByRole('radio', { name: /file/i }).click();
        await dialog.locator('input[type="file"]').setInputFiles({
            name: 'Synthetic history.m3u',
            mimeType: 'audio/x-mpegurl',
            buffer: Buffer.from(
                '#EXTM3U\n#EXTINF:-1,Synthetic first\nhttps://streams.example.test/first.webm\n#EXTINF:-1,Synthetic second\nhttps://streams.example.test/second.webm'
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
        const read = async () =>
            await (
                await fetch(`${server.apiUrl}/v1/history/sources/${sourceId}`, {
                    headers: { 'X-IPTVnator-Instance-Id': instanceId },
                })
            ).json();
        const visible = async () => {
            const { state } = await read();
            return state.items.filter(
                (item: { removed: boolean; revision: number }) =>
                    !item.removed && item.revision > state.cleared
            );
        };
        const open = async (client: Page) => {
            await openSources(client);
            await sourceRowByTitle(client, 'Synthetic history')
                .getByText('Synthetic history', { exact: true })
                .click();
            await expect(client.getByTestId('channel-item')).toHaveCount(2);
        };
        const play = async (client: Page, index: number) => {
            await open(client);
            await startAndConfirmPlayback(
                client,
                () => client.getByTestId('channel-item').nth(index).click(),
                3
            );
        };
        let requests = 0;
        page.on('request', (request) => {
            if (request.url().startsWith(`${server.apiUrl}/v1/history`))
                requests++;
        });
        await play(page, 0);
        expect(requests).toBe(0);
        expect(await visible()).toHaveLength(0);
        await openGlobalRecent(page);
        await expect(
            page
                .getByTestId('channel-item')
                .filter({ hasText: 'Synthetic first' })
        ).toBeVisible();
        const cold = await browser.newContext({
            serviceWorkers: 'block',
            storageState: await context.storageState({ indexedDB: true }),
        });
        try {
            const offline = await cold.newPage();
            await offline.route('**/assets/app-config.js', (route) =>
                route.fulfill({
                    contentType: 'application/javascript',
                    body: `window.__IPTVNATOR_CONFIG__=${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
                })
            );
            await offline.goto(`${frontend}/workspace/global-recent`);
            const row = offline
                .getByTestId('channel-item')
                .filter({ hasText: 'Synthetic first' });
            await expect(row).toBeVisible();
            await row.click({ button: 'right' });
            const remove = offline.getByRole('menuitem', {
                name: 'Remove from history',
                exact: true,
            });
            await expect(remove).toBeVisible();
            await offline.keyboard.press('Escape');
            // The loaded view must keep its first local write independent of the UI host.
            await offline.route(`${frontend}/**`, (route) =>
                route.request().resourceType() === 'script'
                    ? route.abort('failed')
                    : route.continue()
            );
            await row.click({ button: 'right' });
            await remove.click();
            await expect(row).toHaveCount(0);
            await offline.unroute(`${frontend}/**`);
            await offline.reload();
            await expect(row).toHaveCount(0);
            expect(await visible()).toHaveLength(0);
        } finally {
            await cold.close();
        }
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({ apiUrl: server.apiUrl, instanceId })
        );
        desktop = await launchElectronApp(directory);
        let native = desktop.mainWindow;
        await routePlayableStreams(native);
        await settings(page, true);
        expect(await visible()).toHaveLength(0);
        await settings(native, true);
        const originalViewport = page.viewportSize()!;
        await page.setViewportSize({ width: 390, height: 844 });
        for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme });
            await expect(page.locator('body')).toHaveClass(
                new RegExp(`${colorScheme}-theme`)
            );
            const section = page.getByTestId('history-sync-settings');
            await section.scrollIntoViewIfNeeded();
            expect(
                await section.evaluate(
                    (element) => element.scrollWidth <= element.clientWidth
                )
            ).toBe(true);
            await section.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(
                    `history-settings-${colorScheme}.png`
                ),
            });
        }
        await page.setViewportSize(originalViewport);
        await page.emulateMedia({ colorScheme: 'light' });
        await page.getByTestId('history-import-preview').click();
        await expect(page.getByTestId('history-import-confirm')).toBeEnabled();
        await page.getByTestId('history-import-confirm').click();
        await expect.poll(async () => (await visible()).length).toBe(1);
        await openGlobalRecent(native);
        await expect(
            native.getByText('Synthetic first', { exact: true }).first()
        ).toBeVisible({ timeout: 30000 });
        await play(native, 1);
        await expect.poll(async () => (await visible()).length).toBe(2);
        await openGlobalRecent(page);
        await expect(
            page.getByText('Synthetic second', { exact: true }).first()
        ).toBeVisible({ timeout: 30000 });
        const received = await visible();
        expect(received[1].viewedAt).toBeGreaterThan(received[0].viewedAt);
        expect(JSON.stringify(received)).not.toContain('streams.example.test');
        await clearCurrentUnifiedCollection(page);
        await expect.poll(async () => (await visible()).length).toBe(0);
        let blocked = true;
        await page.route('**/v1/history/**', (route) =>
            blocked
                ? route.fulfill({
                      status: 503,
                      json: { error: 'synthetic outage' },
                  })
                : route.continue()
        );
        await play(page, 1);
        expect(await visible()).toHaveLength(0);
        await page.reload();
        await page
            .getByRole('link', { name: 'Recently viewed', exact: true })
            .click();
        await page.waitForURL(/\/workspace\/global-recent$/);
        await expect(
            page.getByText('Synthetic second', { exact: true }).first()
        ).toBeVisible();
        await settings(page);
        await expect(
            page.getByTestId('history-sync-settings').getByRole('status')
        ).toContainText('server unavailable');
        blocked = false;
        await page
            .getByTestId('history-sync-settings')
            .getByRole('button', { name: /refresh/i })
            .click();
        await expect.poll(async () => (await visible()).length).toBe(1);
        await openGlobalRecent(page);
        await clearCurrentUnifiedCollection(page);
        await expect.poll(async () => (await visible()).length).toBe(0);
        await settings(native, false);
        await play(native, 0);
        expect(await visible()).toHaveLength(0);
        await closeElectronApp(desktop);
        desktop = await launchElectronApp(directory);
        native = desktop.mainWindow;
        await routePlayableStreams(native);
        await openGlobalRecent(native);
        await expect(
            native.getByText('Synthetic first', { exact: true }).first()
        ).toBeVisible();
        expect(await visible()).toHaveLength(0);
        await settings(native, true);
        expect(await visible()).toHaveLength(0);
        await native.getByTestId('history-import-preview').click();
        await expect(
            native.getByTestId('history-import-confirm')
        ).toBeEnabled();
        await native.getByTestId('history-import-confirm').click();
        await expect.poll(async () => (await visible()).length).toBe(2);
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await context.close();
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
