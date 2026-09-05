import { Page } from '@playwright/test';
import { createServer } from 'node:net';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    saveSettings,
    test,
} from './electron-test-fixtures';

const pausedMessage = 'skipped after repeated connection failures';
// Xtream currently rejects network failures with a plain object, whose fields
// Electron discards. Stalker preserves the error code in its Error message.
const xtreamNetworkFailure =
    "Error invoking remote method 'XTREAM_REQUEST': [object Object]";

async function unusedLocalOrigin(): Promise<string> {
    const server = createServer();
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('No test port');
    await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
    );
    return `http://127.0.0.1:${address.port}`;
}

/** Real IPC/network failure: both protocols must share the saved policy. */
async function requestFailure(page: Page, origin: string, stalker = false) {
    return page.evaluate(
        async ({ origin, stalker }) => {
            try {
                if (stalker) {
                    await window.electron.stalkerRequest({
                        url: `${origin}/portal.php`,
                        macAddress: '00:1A:79:00:00:01',
                        params: { type: 'stb', action: 'handshake' },
                    });
                } else {
                    await window.electron.xtreamRequest({
                        url: origin,
                        params: {
                            username: 'test',
                            password: 'test',
                            action: 'get_account_info',
                        },
                    });
                }
                return 'unexpected success';
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        },
        { origin, stalker }
    );
}

test('@settings @electron saves the portal cooldown preference and applies it without restart', async ({
    dataDir,
}) => {
    const origin = await unusedLocalOrigin();
    let app = await launchElectronApp(dataDir, {
        omitEnvKeys: ['IPTVNATOR_DISABLE_CONNECTIVITY_GUARD'],
    });
    try {
        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'general');
        let checkbox = app.mainWindow
            .getByTestId('portal-connectivity-toggle')
            .getByRole('checkbox');
        await expect(checkbox).toBeChecked();
        await requestFailure(app.mainWindow, origin);
        await requestFailure(app.mainWindow, origin);
        expect(await requestFailure(app.mainWindow, origin, true)).toContain(
            pausedMessage
        );

        await checkbox.uncheck();
        // An unsaved edit cannot alter backend policy.
        expect(await requestFailure(app.mainWindow, origin)).toContain(
            pausedMessage
        );
        await saveSettings(app.mainWindow);
        for (const stalker of [false, true, false]) {
            expect(
                await requestFailure(app.mainWindow, origin, stalker)
            ).toContain(stalker ? 'ECONNREFUSED' : xtreamNetworkFailure);
        }
        await expect(
            app.mainWindow.locator('mat-snack-bar-container')
        ).toBeHidden();
        await app.mainWindow
            .getByTestId('portal-connectivity-setting')
            .screenshot({
                path: test.info().outputPath('portal-connections.png'),
            });

        await closeElectronApp(app);
        app = await launchElectronApp(dataDir, {
            omitEnvKeys: ['IPTVNATOR_DISABLE_CONNECTIVITY_GUARD'],
        });
        // Check the cold-start mirror before opening Settings or saving again.
        for (let index = 0; index < 3; index++) {
            expect(await requestFailure(app.mainWindow, origin)).toContain(
                xtreamNetworkFailure
            );
        }
        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'general');
        checkbox = app.mainWindow
            .getByTestId('portal-connectivity-toggle')
            .getByRole('checkbox');
        await expect(checkbox).not.toBeChecked();
        await checkbox.check();
        await saveSettings(app.mainWindow);
        expect(await requestFailure(app.mainWindow, origin)).toContain(
            xtreamNetworkFailure
        );
        expect(await requestFailure(app.mainWindow, origin, true)).toContain(
            'ECONNREFUSED'
        );
        expect(await requestFailure(app.mainWindow, origin)).toContain(
            pausedMessage
        );
        await app.mainWindow.getByTestId('DARK_THEME').click();
        await saveSettings(app.mainWindow);
        await expect(
            app.mainWindow.locator('mat-snack-bar-container')
        ).toBeHidden();
        await app.mainWindow
            .getByTestId('portal-connectivity-setting')
            .screenshot({
                path: test.info().outputPath('portal-connections-dark.png'),
            });
        // Unrelated saves (such as theme changes) must preserve the cooldown.
        expect(await requestFailure(app.mainWindow, origin)).toContain(
            pausedMessage
        );
    } finally {
        await closeElectronApp(app);
    }
});
