import { expect, Page, test } from '@playwright/test';
import { join } from 'path';

async function openSettings(page: Page) {
    await page.locator('a[href$="/workspace/settings"]').click();
    await page.waitForURL(/\/workspace\/settings$/);
    await expect(page.locator('.settings-container')).toBeVisible();
    await expect(page.locator('.settings-back-button')).toBeVisible();
}

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
        await openSettings(page);
        await page.locator('.settings-back-button').click();
    });

    test('Change video player', async ({ page }) => {
        await openSettings(page);

        await expect(page.getByText('Video.js player')).toBeVisible();
        await page.getByRole('combobox').nth(1).click();
        await page.getByRole('option', { name: 'HTML5 video player' }).click();

        await page.locator('button[type="submit"]').click();
        await page.locator('.settings-back-button').click();

        await openSettings(page);

        await expect(page.getByText('HTML5 video player')).toBeVisible();
    });

    test('Change app theme', async ({ page }) => {
        await openSettings(page);
        await expect(
            page.getByRole('radio', { name: 'System theme' })
        ).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('radio', { name: 'Dark theme' }).click();

        await page.locator('button[type="submit"]').click();
        await page.locator('.settings-back-button').click();

        await openSettings(page);

        await expect(
            page.getByRole('radio', { name: 'Dark theme' })
        ).toHaveAttribute('aria-checked', 'true');
    });

    test('Change app language', async ({ page }) => {
        await openSettings(page);
        await expect(page.getByText('English')).toBeVisible();
        await page.getByRole('combobox').first().click();
        await page.getByRole('option', { name: 'Deutsch' }).click();

        await page.locator('button[type="submit"]').click();
        await page.locator('.settings-back-button').click();
        await openSettings(page);

        await expect(page.getByText('Deutsch')).toBeVisible();
    });

    test.afterEach(async ({ page }, testInfo) => {
        await page.screenshot({
            path: join(
                process.cwd(),
                'dist/.playwright/apps/web-e2e/screenshots/settings',
                `${testInfo.title}.png`
            ),
        });
    });
});
