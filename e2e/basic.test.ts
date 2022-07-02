import { expect, test } from '@playwright/test';
import {
    BrowserContext,
    ElectronApplication,
    Page,
    _electron as electron,
} from 'playwright';
const PATH = require('path');

test.describe('Check Home Page', async () => {
    let app: ElectronApplication;
    let firstWindow: Page;
    let context: BrowserContext;

    test.beforeAll(async () => {
        app = await electron.launch({
            args: [
                PATH.join(__dirname, '../electron/main.js'),
                PATH.join(__dirname, '../electron/package.json'),
            ],
        });
        context = app.context();
        //await context.tracing.start({ screenshots: true, snapshots: true });

        firstWindow = await app.windows()[0];
        const isMainWindow = (await firstWindow.title()) === 'IPTVnator';
        if (!isMainWindow) {
            firstWindow = await app.windows()[1];
        }
        await firstWindow.waitForLoadState('domcontentloaded');
    });

    test('Launch electron app', async () => {
        const windowState = await app.evaluate(async (process) => {
            let mainWindow = process.BrowserWindow.getAllWindows()[0];
            const isMainWindow = mainWindow.title === 'IPTVnator';
            if (!isMainWindow) {
                mainWindow = process.BrowserWindow.getAllWindows()[1];
            }
            return {
                isVisible: mainWindow.isVisible(),
                isDevToolsOpened: mainWindow.webContents.isDevToolsOpened(),
                isCrashed: mainWindow.webContents.isCrashed(),
            };
        });

        expect(windowState.isVisible).toBeTruthy();
        expect(windowState.isDevToolsOpened).toBeFalsy();
        expect(windowState.isCrashed).toBeFalsy();
        expect(app.windows()).toHaveLength(2);
    });

    test('Check title', async ({ page }) => {
        const title = await firstWindow.title();
        await firstWindow.screenshot({ path: 'e2e/screenshots/intro.png' });
        expect(title).toBe('IPTVnator');
    });
});
