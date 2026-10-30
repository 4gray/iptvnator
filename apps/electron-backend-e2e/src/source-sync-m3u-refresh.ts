import type { APIRequestContext } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    closeElectronApp,
    expect,
    expectPlaylistUpdatedToast,
    launchElectronApp,
    openSources,
    sourceRowByTitle,
    waitForM3uCatalog,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';

/** A late worker response must not PATCH the original URL over a NAS edit. */
export async function verifyDelayedSharedM3uRefresh(
    request: APIRequestContext
) {
    const server = await startSourceSyncServer();
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-sync-refresh-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    let holdOld = false;
    let waiting = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const provider = createServer(async (incoming, outgoing) => {
        const old = incoming.url === '/old.m3u';
        if (old && holdOld) {
            waiting = true;
            await gate;
        }
        outgoing.setHeader('Content-Type', 'application/x-mpegURL');
        outgoing.end(
            `#EXTM3U\n#EXTINF:-1,${old ? 'Old' : 'New'} source channel\nhttps://streams.example.test/${old ? 'old' : 'new'}.ts`
        );
    });
    try {
        await new Promise<void>((resolve) =>
            provider.listen(0, '127.0.0.1', resolve)
        );
        const address = provider.address();
        if (!address || typeof address === 'string')
            throw new Error('Fixture provider has no TCP address');
        const source = {
            id: 'delayed-refresh',
            title: 'Delayed shared M3U',
            kind: 'm3u-url',
            url: `http://127.0.0.1:${address.port}/old.m3u`,
        };
        const created = await request.put(
            `${server.apiUrl}/v1/sources/${source.id}`,
            {
                headers: { 'If-None-Match': '*' },
                data: source,
            }
        );
        expect(created.ok()).toBe(true);
        const { instanceId } = await (
            await request.get(`${server.apiUrl}/v1/instance`)
        ).json();
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({ apiUrl: server.apiUrl, instanceId })
        );
        desktop = await launchElectronApp(directory);
        const page = desktop.mainWindow;
        await openSources(page);
        const row = sourceRowByTitle(page, source.title);
        await expect(row).toBeVisible();
        holdOld = true;
        await row
            .getByRole('button', { name: 'Refresh playlist', exact: true })
            .click();
        await expect.poll(() => waiting).toBe(true);
        const accepted = {
            ...source,
            url: source.url.replace('old.m3u', 'new.m3u'),
        };
        const edited = await request.patch(
            `${server.apiUrl}/v1/sources/${source.id}`,
            {
                headers: { 'If-Match': created.headers()['etag'] },
                data: accepted,
            }
        );
        expect(edited.ok()).toBe(true);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect
            .poll(
                async () =>
                    (
                        await page.evaluate(
                            (id) => window.electron.dbGetAppPlaylist(id),
                            source.id
                        )
                    )?.url
            )
            .toBe(accepted.url);
        await expect(row).toContainText('new.m3u');
        release();
        await expectPlaylistUpdatedToast(page);
        // Route reads join the refresh save queue, so these assertions observe
        // the settled refresh write rather than the earlier projection alone.
        await row
            .getByRole('button', { name: source.title, exact: true })
            .click();
        await waitForM3uCatalog(page);
        await expect(
            page.locator('app-channel-list-item').first()
        ).toContainText('New source channel');
        await expect(
            page
                .locator('app-channel-list-item')
                .filter({ hasText: 'Old source channel' })
        ).toHaveCount(0);
        const stored = await request.get(
            `${server.apiUrl}/v1/sources/${source.id}`
        );
        expect(await stored.json()).toMatchObject(accepted);
        expect(stored.headers()['etag']).toBe(edited.headers()['etag']);
    } finally {
        release();
        if (desktop) await closeElectronApp(desktop);
        provider.closeAllConnections();
        if (provider.listening)
            await new Promise<void>((resolve) =>
                provider.close(() => resolve())
            );
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
}
