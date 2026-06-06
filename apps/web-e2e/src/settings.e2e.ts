import type { Page } from '@playwright/test';
import { join } from 'path';
import { expect, test } from './fixtures';

async function openSettings(page: Page) {
    await page.locator('a[href$="/workspace/settings"]').click();
    await page.waitForURL(/\/workspace\/settings$/);
    await expect(page.locator('.settings-container')).toBeVisible();
    await expect(page.locator('.settings-back-button')).toBeVisible();
}

async function saveSettings(page: Page) {
    const saveButton = page.locator('[data-test-id="save-settings"]');

    await saveButton.click();
    await expect(saveButton).toBeDisabled();
}

test.describe('Settings', () => {
    test.beforeEach(async ({ page }) => {
        // Playwright creates a fresh browser context per test, so extra
        // IndexedDB cleanup here only risks racing with app-managed DB handles.
        await page.goto('/');
    });

    test('@settings @web Check settings page', async ({ page }) => {
        await openSettings(page);
        await page.locator('.settings-back-button').click();
    });

    test('@settings @web Change video player', async ({ page }) => {
        await openSettings(page);

        const playerSelect = page.locator('[data-test-id="select-video-player"]');

        await expect(playerSelect).toContainText(
            /Video\.js/i
        );
        await playerSelect.click();
        await page.locator('mat-option[data-test-id="html5"]').click();

        await saveSettings(page);
        await page.reload();
        await openSettings(page);

        await expect(playerSelect).toContainText(
            /HTML5/i
        );
    });

    test('@settings @web Change app theme', async ({ page }) => {
        await openSettings(page);
        // v0.22 compact theme picker exposes the segmented control as a
        // radiogroup with options labelled just "Light"/"Dark"/"System".
        // Scope to the theme radiogroup so we don't collide with the
        // identically-labelled cover-size options below.
        const themeGroup = page.locator(
            '[data-test-id="select-theme"][role="radiogroup"]'
        );
        await expect(
            themeGroup.getByRole('radio', { name: 'System', exact: true })
        ).toHaveAttribute('aria-checked', 'true');
        await themeGroup
            .getByRole('radio', { name: 'Dark', exact: true })
            .click();

        await saveSettings(page);
        await page.reload();
        await openSettings(page);

        await expect(
            themeGroup.getByRole('radio', { name: 'Dark', exact: true })
        ).toHaveAttribute('aria-checked', 'true');
    });

    test('@settings @web Change app language', async ({ page }) => {
        await openSettings(page);
        const languageSelect = page.locator('[data-test-id="select-language"]');

        await expect(languageSelect).toContainText(
            'English'
        );
        await languageSelect.click();
        await page.locator('mat-option[data-test-id="de"]').click();

        await saveSettings(page);
        await page.reload();
        await openSettings(page);

        await expect(languageSelect).toContainText(
            'Deutsch'
        );
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
