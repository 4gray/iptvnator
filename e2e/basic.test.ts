import { Browser, chromium, expect, test } from '@playwright/test';
import {
    BrowserContext,
    ElectronApplication,
    Page,
    _electron as electron,
} from 'playwright';
const PATH = require('path');

test.describe('Check Home Page', () => {
    let app: ElectronApplication;
    let page: Page;
    let context: BrowserContext;
    let browser: Browser;

    test.beforeAll(async () => {
        app = await electron.launch({
            args: [PATH.join(__dirname, '../electron/main.js')],
        });

        browser = await chromium.launch();
        context = await browser.newContext();
        await context.tracing.start({ screenshots: true });

        page = app.windows()[0];
        const isMainWindow = (await page.title()) === 'IPTVnator';
        if (!isMainWindow) {
            page = app.windows()[1];
        }
        await page.waitForLoadState('domcontentloaded');
    });

    test('Launch electron app', async () => {
        const windowState = await app.evaluate((process) => {
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

    // eslint-disable-next-line no-empty-pattern
    test('Check title of the application', async ({}, testInfo) => {
        const title = await page.title();
        const screenshot = await page.screenshot({
            path: './e2e/screenshots/home/no-playlists.png',
        });
        await testInfo.attach('screenshot', {
            body: screenshot,
            contentType: 'image/png',
        });
        expect(title).toBe('IPTVnator');
    });
});
