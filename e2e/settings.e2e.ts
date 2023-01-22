import { expect, test } from '@playwright/test';
import {
    BrowserContext,
    ElectronApplication,
    Page,
    _electron as electron,
} from 'playwright';
const PATH = require('path');

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

test.describe('Settings', () => {
    test('Check settings page', async () => {
        await page.getByTestId('open-settings').click();
        await expect(page.getByTestId('settings-container')).toBeVisible();
        await page.getByTestId('back-to-home').click();
    });

    test('Change video player', async () => {
        await page.getByTestId('open-settings').click();

        await expect(page.locator('text="VideoJs Player"')).toBeVisible();
        await page.getByTestId('select-video-player').click();
        await page.getByTestId('html5').click();

        await page.getByTestId('save-settings').click();
        await page.getByTestId('back-to-home').click();
        await page.getByTestId('open-settings').click();

        await expect(page.locator('text="HTML5 Video Player"')).toBeVisible();
    });

    test('Change app theme', async () => {
        await page.getByTestId('open-settings').click();

        await expect(page.locator('text="Light theme"')).toBeVisible();
        await page.getByTestId('select-theme').click();
        await page.getByTestId('DARK_THEME').click();

        await page.getByTestId('save-settings').click();
        await page.getByTestId('back-to-home').click();
        await page.getByTestId('open-settings').click();

        await expect(page.locator('text="Dark theme"')).toBeVisible();
    });

    test('Change app language', async () => {
        await page.getByTestId('open-settings').click();

        await expect(page.locator('text="English"')).toBeVisible();
        await page.getByTestId('select-language').click();
        await page.getByTestId('de').click();

        await page.getByTestId('save-settings').click();
        await page.getByTestId('back-to-home').click();
        await page.getByTestId('open-settings').click();

        await expect(page.locator('text="Deutsch"')).toBeVisible();
    });
});

test.beforeEach(async () => {
    await page.evaluate(async () => {
        const dbNames = (await window.indexedDB.databases()).map(
            (db) => db.name
        );
        dbNames.forEach((name) =>
            name !== undefined ? window.indexedDB.deleteDatabase(name) : null
        );
    });
});

// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
    await page.screenshot({
        path: `./e2e/screenshots/home/${testInfo.title}.png`,
    });
});

test.afterAll(async () => {
    await page.close();
    await app.close();
});
