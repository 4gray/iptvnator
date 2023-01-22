import { expect, test } from '@playwright/test';
import {
    BrowserContext,
    ElectronApplication,
    Page,
    _electron as electron,
} from 'playwright';
const PATH = require('path');
const fs = require('fs');

let app: ElectronApplication;
let page: Page;
let context: BrowserContext;

test.beforeAll(async () => {
    app = await electron.launch({
        args: [PATH.join(__dirname, '../electron/main.js')],
        env: {
            e2e: 'true',
        },
    });

    context = app.context();
    await context.tracing.start({ screenshots: true, snapshots: true });

    page = await app.firstWindow();
    const isMainWindow = (await page.title()) === 'IPTVnator';
    if (!isMainWindow) {
        page = app.windows()[1];
    }
    await page.waitForLoadState('domcontentloaded');
});

test.describe('Check Home Page', () => {
    test('Launch electron app', async () => {
        const windowState = await app.evaluate((electronProcess) => {
            let mainWindow = electronProcess.BrowserWindow.getAllWindows()[0];
            const isMainWindow = mainWindow.title === 'IPTVnator';
            if (!isMainWindow) {
                mainWindow = electronProcess.BrowserWindow.getAllWindows()[1];
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
            path: `./e2e/screenshots/home/${testInfo.title}.png`,
        });
        await testInfo.attach('screenshot', {
            body: screenshot,
            contentType: 'image/png',
        });
        expect(title).toBe('IPTVnator');
    });
});

test.describe('Upload playlists', () => {
    test('should upload m3u playlist via file upload', async () => {
        await page.click('"Add via file upload"');
        await page.setInputFiles(
            'input[type="file"]',
            './e2e/fixtures/test.m3u'
        );
        await expect(page.getByTestId('channel-item')).toHaveCount(4);
    });
});

test.afterAll(async () => {
    deleteDbFile();
    await page.close();
    await app.close();
});

function deleteDbFile() {
    const pathToFile = './e2e/db/data.db';

    try {
        fs.unlink(pathToFile, () => {
            console.log('db file was deleted');
        });
    } catch (error) {
        console.log('db file not found');
    }
}
