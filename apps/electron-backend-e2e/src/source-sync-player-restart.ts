import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';

function playerIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** Exercise real MPV ownership/shutdown with a quiet, long-lived child. */
export async function verifySourceRestartStopsPlayer(
    operation: 'connect' | 'disconnect'
) {
    const server = await startSourceSyncServer();
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-sync-player-'));
    const playerPath = join(directory, 'managed-player');
    // Match the /api mount supplied by nginx in the self-hosted deployment.
    const gateway = createServer(async (incoming, outgoing) => {
        const response = await fetch(
            `${server.apiUrl}${incoming.url?.replace(/^\/api/, '') ?? ''}`
        );
        const etag = response.headers.get('etag');
        if (etag) outgoing.setHeader('ETag', etag);
        outgoing.writeHead(response.status, {
            'Content-Type': 'application/json',
        });
        outgoing.end(await response.text());
    });
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    let playerPid: number | undefined;
    try {
        await new Promise<void>((resolve) =>
            gateway.listen(0, '127.0.0.1', resolve)
        );
        const address = gateway.address();
        if (!address || typeof address === 'string')
            throw new Error('Missing gateway address');
        const apiUrl = `http://127.0.0.1:${address.port}/api`;
        if (operation === 'disconnect') {
            const { instanceId } = await (
                await fetch(`${server.apiUrl}/v1/instance`)
            ).json();
            writeFileSync(
                join(directory, 'source-server.json'),
                JSON.stringify({ apiUrl, instanceId })
            );
        }
        desktop = await launchElectronApp(directory);
        await openSources(desktop.mainWindow);
        await desktop.electronApp.evaluate(
            ({ app }, { playerPath, nodePath }) => {
                const childProcess = process.getBuiltinModule('child_process');
                const spawn = childProcess.spawn;
                childProcess.spawn = ((command, ...args) => {
                    if (command !== playerPath)
                        return Reflect.apply(spawn, childProcess, [
                            command,
                            ...args,
                        ]);
                    const child = spawn(
                        nodePath,
                        ['-e', 'setInterval(() => {}, 1000)'],
                        {
                            stdio: ['ignore', 'pipe', 'pipe'],
                            detached: false,
                        }
                    );
                    Reflect.set(globalThis, '__sourceSyncPlayerPid', child.pid);
                    return child;
                }) as typeof spawn;
                // Keep process/relaunch ownership in the fixture. Ordinary
                // will-quit is deliberately absent when checking the child.
                app.relaunch = () => undefined;
                app.exit = () => undefined;
            },
            { playerPath, nodePath: process.execPath }
        );
        const page = desktop.mainWindow;
        await page.evaluate(async (playerPath) => {
            await window.electron.setMpvPlayerPath(playerPath);
            await window.electron.updateSettings({ mpvReuseInstance: true });
            await window.electron.openInMpv(
                'https://streams.example.test/test.ts',
                'Managed player',
                '',
                ''
            );
        }, playerPath);
        playerPid = await desktop.electronApp.evaluate(
            () => Reflect.get(globalThis, '__sourceSyncPlayerPid') as number
        );
        expect(playerPid).toBeGreaterThan(0);
        expect(playerIsAlive(playerPid)).toBe(true);
        await page.evaluate(
            async ({ operation, apiUrl }) => {
                if (operation === 'connect')
                    await window.electron.sourceSyncConfigure!(
                        apiUrl,
                        '',
                        true
                    );
                else await window.electron.sourceSyncDisconnect!();
            },
            { operation, apiUrl }
        );
        await expect.poll(() => playerIsAlive(playerPid!)).toBe(false);
    } finally {
        if (desktop && !playerPid)
            playerPid = await desktop.electronApp
                .evaluate(
                    () =>
                        Reflect.get(globalThis, '__sourceSyncPlayerPid') as
                            number | undefined
                )
                .catch(() => undefined);
        if (playerPid && playerIsAlive(playerPid)) process.kill(playerPid);
        if (desktop) await closeElectronApp(desktop);
        gateway.closeAllConnections();
        if (gateway.listening)
            await new Promise<void>((resolve) =>
                gateway.close(() => resolve())
            );
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
}
