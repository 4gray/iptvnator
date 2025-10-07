import { expect, test } from '@playwright/test';

test.describe('Settings', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Clear IndexedDB before each test
        await page.evaluate(async () => {
            const dbNames = (await window.indexedDB.databases()).map(
                (db) => db.name
            );
            dbNames.forEach((name) =>
                name !== undefined
                    ? window.indexedDB.deleteDatabase(name)
                    : null
            );
        });
    });

    test('Check settings page', async ({ page }) => {
        await page.getByTestId('pwa-menu').click();
        await page.getByTestId('pwa-open-settings').click();
        await expect(page.getByTestId('settings-container')).toBeVisible();
        await page.getByTestId('back-to-home').click();
    });

    test('Change video player', async ({ page }) => {
        await page.getByTestId('pwa-menu').click();
        await page.getByTestId('pwa-open-settings').click();

        await expect(page.locator('text="VideoJs Player"')).toBeVisible();
        await page.getByTestId('select-video-player').click();
        await page.getByTestId('html5').click();

        await page.getByTestId('save-settings').click();
        await page.getByTestId('back-to-home').click();

        await page.getByTestId('pwa-menu').click();
        await page.getByTestId('pwa-open-settings').click();

        await expect(page.locator('text="HTML5 Video Player"')).toBeVisible();
    });

    test('Change app theme', async ({ page }) => {
        await page.getByTestId('pwa-menu').click();
        await page.getByTestId('pwa-open-settings').click();
        await expect(page.locator('text="Light theme"')).toBeVisible();
        await page.getByTestId('select-theme').click();
        await page.getByTestId('DARK_THEME').click();

        await page.getByTestId('save-settings').click();
        await page.getByTestId('back-to-home').click();

        await page.getByTestId('pwa-menu').click();
        await page.getByTestId('pwa-open-settings').click();

        await expect(page.locator('text="Dark theme"')).toBeVisible();
    });

    test('Change app language', async ({ page }) => {
        await page.getByTestId('pwa-menu').click();
        await page.getByTestId('pwa-open-settings').click();
        await expect(page.locator('text="English"')).toBeVisible();
        await page.getByTestId('select-language').click();
        await page.getByTestId('de').click();

        await page.getByTestId('save-settings').click();
        await page.getByTestId('back-to-home').click();
        await page.getByTestId('pwa-menu').click();
        await page.getByTestId('pwa-open-settings').click();

        await expect(page.locator('text="Deutsch"')).toBeVisible();
    });

    test.afterEach(async ({ page }, testInfo) => {
        await page.screenshot({
            path: `./e2e/screenshots/settings/${testInfo.title}.png`,
        });
    });
});
