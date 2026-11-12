import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    closeElectronApp,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    saveSettings,
    setSwitch,
} from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';

test.skip(
    process.env['IPTVNATOR_E2E_SOURCE_SYNC'] !== '1',
    'Run with playwright.source-sync.config.ts'
);
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function metadata(page: Page) {
    await openSettings(page);
    await openSettingsSection(page, 'tmdb');
}

async function openTransfer(page: Page) {
    await page
        .getByRole('button', { name: 'Transfer key from another device' })
        .click();
    return page.getByRole('dialog');
}

async function receive(page: Page) {
    const dialog = await openTransfer(page);
    await dialog.getByRole('button', { name: 'Receive key' }).click();
    return {
        dialog,
        code: await dialog.getByLabel('Transfer code').inputValue(),
    };
}

async function send(page: Page, code: string) {
    const dialog = await openTransfer(page);
    await dialog.getByRole('button', { name: 'Send a saved key' }).click();
    await dialog.getByLabel('Transfer code').fill(code);
    await dialog.getByRole('button', { name: 'Send key', exact: true }).click();
    return dialog;
}

const switchOn = (page: Page) =>
    setSwitch(page.getByTestId('tmdb-enabled').getByRole('switch'), true);

async function failNextSettingsWrite(page: Page) {
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
            const request = put.call(this, value, key);
            if (key === 'settings') {
                IDBObjectStore.prototype.put = put;
                this.transaction.abort();
            }
            return request;
        };
    });
}

test('transfers and rotates the personal TMDB key between PWA and Electron @electron @settings', async ({
    page,
}) => {
    const server = await startSourceSyncServer();
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-tmdb-transfer-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    const firstKey = 'synthetic-initial-key';
    const rotatedKey = 'synthetic-rotated-key';
    try {
        const { instanceId } = await (
            await fetch(`${server.apiUrl}/v1/instance`)
        ).json();
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({ apiUrl: server.apiUrl, instanceId })
        );
        desktop = await launchElectronApp(directory);
        const native = desktop.mainWindow;
        await Promise.all(
            [page, native].map((client) =>
                client.route('https://api.themoviedb.org/**', (route) =>
                    route.abort()
                )
            )
        );
        await page.context().route('**/assets/app-config.js', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `window.__IPTVNATOR_CONFIG__ = ${JSON.stringify({ BACKEND_URL: server.apiUrl })};`,
            })
        );
        await page.goto(
            `http://localhost:${process.env['SOURCE_SYNC_WEB_PORT']}/workspace/sources`
        );
        await metadata(page);
        await metadata(native);

        await switchOn(page);
        await page.getByTestId('tmdb-api-key').fill(firstKey);
        await saveSettings(page);

        const cancelled = await receive(native);
        await cancelled.dialog
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();
        const refused = await send(page, cancelled.code);
        await expect(refused.getByRole('alert')).toContainText(
            'no longer available'
        );
        await refused
            .getByRole('button', { name: 'Cancel', exact: true })
            .click();

        const receiving = await receive(native);
        const sending = await send(page, receiving.code);
        await expect(
            sending.getByText('Key sent.', { exact: false })
        ).toBeVisible();
        await sending
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        await receiving.dialog
            .getByRole('button', { name: 'Save key', exact: true })
            .click();
        await expect(receiving.dialog).toBeHidden();

        const desktopToggle = native
            .getByTestId('tmdb-enabled')
            .getByRole('switch');
        await expect(desktopToggle).not.toBeChecked();
        await switchOn(native);
        await expect(native.getByTestId('tmdb-api-key')).toHaveValue(firstKey);
        await native.getByTestId('tmdb-api-key').fill(rotatedKey);
        await saveSettings(native);

        const replacing = await receive(page);
        const rotating = await send(native, replacing.code);
        await expect(
            rotating.getByText('Key sent.', { exact: false })
        ).toBeVisible();
        await expect(
            replacing.dialog.getByText(
                'This device already has a saved TMDB key.',
                { exact: false }
            )
        ).toBeVisible();
        await expect(page.getByTestId('tmdb-api-key')).toHaveValue(firstKey);
        await failNextSettingsWrite(page);
        const replace = replacing.dialog.getByRole('button', {
            name: 'Replace key',
            exact: true,
        });
        await replace.click();
        await expect(replacing.dialog.getByRole('alert')).toContainText(
            'Could not save the key'
        );
        await expect(page.getByTestId('tmdb-api-key')).toHaveValue(firstKey);

        const contender = await page.context().newPage();
        await contender.route('https://api.themoviedb.org/**', (route) =>
            route.abort()
        );
        await contender.goto(page.url());
        const competing = await receive(contender);
        await rotating
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        const secondSend = await send(native, competing.code);
        await expect(
            secondSend.getByText('Key sent.', { exact: false })
        ).toBeVisible();
        const compete = competing.dialog.getByRole('button', {
            name: 'Replace key',
            exact: true,
        });
        await failNextSettingsWrite(contender);
        await compete.click();
        await expect(competing.dialog.getByRole('alert')).toContainText(
            'Could not save the key'
        );

        await Promise.all([replace.click(), compete.click()]);
        const keyChanged = (client: Page) =>
            client.getByText('The saved key changed during this transfer.', {
                exact: false,
            });
        await expect
            .poll(async () =>
                Promise.all(
                    [page, contender].map((client) =>
                        keyChanged(client).isVisible()
                    )
                ).then((outcomes) => outcomes.filter(Boolean).length)
            )
            .toBe(1);
        const staleTab = (await keyChanged(page).isVisible())
            ? page
            : contender;
        await staleTab
            .getByRole('dialog')
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        await expect(staleTab.getByTestId('tmdb-api-key')).toHaveValue(
            rotatedKey
        );
        await setSwitch(
            staleTab.getByTestId('tmdb-enabled').getByRole('switch'),
            false
        );
        await saveSettings(staleTab);
        await page.reload();
        await expect(
            page.getByTestId('tmdb-enabled').getByRole('switch')
        ).not.toBeChecked();
        await switchOn(page);
        await expect(page.getByTestId('tmdb-api-key')).toHaveValue(rotatedKey);
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
