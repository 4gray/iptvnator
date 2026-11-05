import type { APIRequestContext, Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSourceEditor,
    openSources,
    resetMockServers,
    restartElectronApp,
    saveSourceDialog,
    stalkerMockServer,
    updateSourceDialog,
    waitForStalkerCatalog,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';

const sourceId = 'shared-stalker-session';
const title = 'Shared session edit';
const readSession = (page: Page) =>
    page.evaluate((id) => window.electron.dbGetAppPlaylist(id), sourceId);

/** Real discovery, shared persistence and a fresh Electron main process. */
export async function verifySharedStalkerSessionEditing(
    request: APIRequestContext
) {
    await resetMockServers(request, ['stalker']);
    const server = await startSourceSyncServer();
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-sync-session-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        const source = {
            id: sourceId,
            title,
            kind: 'stalker',
            portalUrl: `${stalkerMockServer}/server/load.php`,
            macAddress: '00:1A:79:00:00:71',
            isFullStalkerPortal: true,
        };
        expect(
            (
                await request.put(`${server.apiUrl}/v1/sources/${sourceId}`, {
                    headers: { 'If-None-Match': '*' },
                    data: source,
                })
            ).ok()
        ).toBe(true);
        const { instanceId } = await (
            await request.get(`${server.apiUrl}/v1/instance`)
        ).json();
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({ apiUrl: server.apiUrl, instanceId })
        );
        desktop = await launchElectronApp(directory);
        await openSources(desktop.mainWindow);
        await desktop.mainWindow
            .getByRole('main')
            .getByRole('button', { name: title, exact: true })
            .click();
        await waitForStalkerCatalog(desktop.mainWindow);
        await openSources(desktop.mainWindow);
        const editor = await openSourceEditor(desktop.mainWindow, title);
        await updateSourceDialog(editor, {
            portalUrl: `${stalkerMockServer}/ministra/c`,
        });
        await saveSourceDialog(desktop.mainWindow, editor);
        const edited = await readSession(desktop.mainWindow);
        expect(edited).toMatchObject({
            portalUrl: `${stalkerMockServer}/ministra/server/load.php`,
            isFullStalkerPortal: true,
            stalkerToken: expect.any(String),
            stalkerSessionIdentity: expect.any(String),
            stalkerWatchdogTimeout: expect.any(Number),
        });
        expect(edited!.stalkerToken).not.toBe('');
        expect(edited!.stalkerSessionIdentity).toContain(
            '/ministra/server/load.php'
        );
        expect(
            JSON.stringify(
                await (
                    await request.get(`${server.apiUrl}/v1/sources/${sourceId}`)
                ).json()
            )
        ).not.toContain('stalkerToken');
        desktop = await restartElectronApp(desktop, directory);
        await openSources(desktop.mainWindow);
        expect(await readSession(desktop.mainWindow)).toMatchObject({
            stalkerToken: edited!.stalkerToken,
            stalkerSessionIdentity: edited!.stalkerSessionIdentity,
            stalkerWatchdogTimeout: edited!.stalkerWatchdogTimeout,
        });
        await desktop.mainWindow
            .getByRole('main')
            .getByRole('button', { name: title, exact: true })
            .click();
        await waitForStalkerCatalog(desktop.mainWindow);
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
}
