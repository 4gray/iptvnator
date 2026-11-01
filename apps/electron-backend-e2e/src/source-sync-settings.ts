import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    closeElectronApp,
    launchElectronApp,
    openSettings,
    openSettingsSection,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';

export async function verifySourceConnectionRecheck() {
    const token = 'synthetic-renewed-token';
    const server = await startSourceSyncServer(token);
    const directory = mkdtempSync(
        join(tmpdir(), 'iptvnator-connection-recheck-')
    );
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        const { instanceId } = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({ apiUrl: server.apiUrl, instanceId })
        );
        desktop = await launchElectronApp(directory);
        const page = desktop.mainWindow;
        const pid = desktop.electronApp.process().pid;
        // A locked first synchronization shows the recovery screen, not the rail.
        await page
            .getByRole('button', { name: 'Open settings', exact: true })
            .click();
        await openSettingsSection(page, 'server');
        await page.evaluate(() =>
            Reflect.set(window, '__connectionSession', 'kept')
        );
        await page.getByTestId('source-server-token').fill(token);
        await page.getByTestId('source-server-connect').click();
        await expect(page.getByTestId('source-server-state')).toHaveText(
            'Connected'
        );
        await expect(page.getByTestId('source-server-connect')).toBeDisabled();
        await page.getByTestId('source-server-refresh').click();
        expect(
            await page.evaluate(() =>
                Reflect.get(window, '__connectionSession')
            )
        ).toBe('kept');
        await page.evaluate(
            async ({ apiUrl, token }) => {
                await window.electron!.sourceSyncConfigure!(
                    apiUrl,
                    token,
                    true
                );
            },
            { apiUrl: server.apiUrl, token }
        );
        expect(desktop.electronApp.process().pid).toBe(pid);
        expect(
            await page.evaluate(() =>
                Reflect.get(window, '__connectionSession')
            )
        ).toBe('kept');
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
}

/** Exercise the actual preload/main bridge against a disposable failing server. */
export async function verifySourceSettingsRecovery() {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-server-settings-'));
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
        release = resolve;
    });
    const server = createServer(async (_request, response) => {
        await wait;
        response.destroy();
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing test address');
    const url = `http://127.0.0.1:${address.port}`;
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        desktop = await launchElectronApp(directory);
        const page = desktop.mainWindow;
        await openSettings(page);
        await openSettingsSection(page, 'server');
        const input = page.getByTestId('source-server-url');
        const token = page.getByTestId('source-server-token');
        const connect = page.getByTestId('source-server-connect');
        await input.fill('nas');
        await token.fill('synthetic-desktop-token');
        await connect.click();
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('#server mat-error')).toBeVisible();
        await expect(token).toHaveValue('synthetic-desktop-token');
        await input.fill(url);
        await connect.click();
        await expect(connect).toBeDisabled();
        await expect(connect).toContainText('Connecting');
        release();
        await expect(page.getByTestId('source-server-message')).toContainText(
            'Check the server address'
        );
        await expect(token).toHaveValue('synthetic-desktop-token');
        await expect(input).toHaveValue(url);
        await expect(connect).toBeEnabled();
    } finally {
        release();
        if (desktop) await closeElectronApp(desktop);
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
    }
}
