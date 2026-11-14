import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    closeElectronApp,
    electronMainPath,
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

export async function verifySourceReconnectAfterRestart() {
    const token = 'synthetic-reconnect-token';
    const server = await startSourceSyncServer(token);
    const directory = mkdtempSync(
        join(tmpdir(), 'iptvnator-source-reconnect-')
    );
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    const entryPoint = join(directory, 'protected-storage.cjs');
    const launch = async () => {
        desktop = await launchElectronApp(directory, { entryPoint });
        return desktop;
    };
    try {
        // Install the same protected-storage fixture before each process bootstraps.
        writeFileSync(
            entryPoint,
            `
const { app, safeStorage } = require('electron');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const key = Buffer.alloc(32, 17);
safeStorage.isEncryptionAvailable = () => true;
safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret';
safeStorage.encryptString = (value) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
};
safeStorage.decryptString = (value) => {
    const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
};
// Playwright launches the replacement process so it can attach to it.
app.relaunch = () => undefined;
require(${JSON.stringify(electronMainPath)});
`
        );
        const { instanceId } = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({ apiUrl: server.apiUrl, instanceId })
        );
        let client = await launch();
        let page = client.mainWindow;
        await page
            .getByRole('button', { name: 'Open settings', exact: true })
            .click();
        await openSettingsSection(page, 'server');
        await page.getByTestId('source-server-token').fill(token);
        await page.getByTestId('source-server-connect').click();
        await expect(page.getByTestId('source-server-state')).toHaveText(
            'Connected'
        );

        let exit = client.electronApp.waitForEvent('close');
        await page
            .getByRole('button', { name: 'Disconnect', exact: true })
            .click({ noWaitAfter: true });
        await exit;
        client = await launch();
        page = client.mainWindow;
        await openSettings(page);
        await openSettingsSection(page, 'server');
        await expect(page.getByTestId('source-server-state')).toHaveCount(0);
        await expect(
            page.getByText('Local library', { exact: true })
        ).toBeVisible();
        await expect(page.getByTestId('source-server-url')).toHaveValue(
            server.apiUrl
        );
        await expect(page.getByTestId('source-server-token')).toHaveValue('');
        await expect(page.getByText('Saved access token')).toBeVisible();

        exit = client.electronApp.waitForEvent('close');
        await page
            .getByRole('button', { name: 'Reconnect', exact: true })
            .click({ noWaitAfter: true });
        await exit;
        client = await launch();
        page = client.mainWindow;
        await openSettings(page);
        await openSettingsSection(page, 'server');
        await expect(page.getByTestId('source-server-state')).toHaveText(
            'Connected'
        );

        exit = client.electronApp.waitForEvent('close');
        await page
            .getByRole('button', { name: 'Disconnect', exact: true })
            .click({ noWaitAfter: true });
        await exit;
        client = await launch();
        page = client.mainWindow;
        await openSettings(page);
        await openSettingsSection(page, 'server');
        await page
            .getByRole('button', { name: 'Forget server', exact: true })
            .click();
        await expect(page.getByTestId('source-server-url')).toHaveValue('');
        await closeElectronApp(client);
        client = await launch();
        page = client.mainWindow;
        await openSettings(page);
        await openSettingsSection(page, 'server');
        await expect(page.getByTestId('source-server-url')).toHaveValue('');
        await expect(
            page.getByRole('button', { name: 'Reconnect', exact: true })
        ).toHaveCount(0);
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
}
