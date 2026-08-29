import type { Page } from '@playwright/test';
import { join } from 'path';
import { expect, test } from './fixtures';

async function openSettings(page: Page) {
    await page.locator('a[href$="/workspace/settings"]').click();
    // The bare settings URL redirects to the default section page.
    await page.waitForURL(/\/workspace\/settings\/general$/);
    await expect(page.locator('.settings-container')).toBeVisible();
    await expect(page.locator('.settings-back-button')).toBeVisible();
}

/** Settings render one section page at a time — open it via the rail. */
async function openSettingsSection(page: Page, sectionId: string) {
    await page.locator(`[data-test-id="settings-section-${sectionId}"]`).click();
    await page.waitForURL(new RegExp(`/workspace/settings/${sectionId}$`));
}

async function saveSettings(page: Page) {
    const saveButton = page.locator('[data-test-id="save-settings"]');

    await saveButton.click();
    // A successful save marks the form pristine, which removes the whole
    // unsaved-changes bar together with the save button.
    await expect(saveButton).toBeHidden();
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
        await openSettingsSection(page, 'playback');

        const playerSelect = page.locator('[data-test-id="select-video-player"]');

        await expect(playerSelect).toContainText(
            /Video\.js/i
        );
        await playerSelect.click();
        await page.locator('mat-option[data-test-id="html5"]').click();

        await saveSettings(page);
        await page.reload();
        await openSettings(page);
        await openSettingsSection(page, 'playback');

        await expect(playerSelect).toContainText(
            /HTML5/i
        );
    });

    test('@settings @web Opt out of shared web player controls', async ({
        page,
    }) => {
        await openSettings(page);
        await openSettingsSection(page, 'playback');

        const setting = page.locator(
            '[data-test-id="web-player-shared-controls-setting"]'
        );
        const checkbox = setting.locator('input[type="checkbox"]');

        await expect(setting).toBeVisible();
        // Shared controls default ON; the checkbox is the opt-out.
        await expect(checkbox).toBeChecked();
        await checkbox.uncheck();
        await saveSettings(page);
        await page.reload();
        await openSettings(page);
        await openSettingsSection(page, 'playback');

        await expect(checkbox).not.toBeChecked();
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

    test('@settings @web Deep links open one section page and unknown sections redirect', async ({
        page,
    }) => {
        await page.goto('/workspace/settings/playback');

        // Only the routed section renders — the playback controls are
        // there, the general ones are not.
        await expect(
            page.locator('[data-test-id="select-video-player"]')
        ).toBeVisible();
        await expect(
            page.locator('[data-test-id="select-language"]')
        ).toHaveCount(0);

        // A stale or mistyped section URL is rewritten to the default page.
        await page.goto('/workspace/settings/nonsense');
        await page.waitForURL(/\/workspace\/settings\/general$/);
        await expect(
            page.locator('[data-test-id="select-language"]')
        ).toBeVisible();
    });

    test('@settings @web Unsaved bar survives section switches and discard reverts', async ({
        page,
    }) => {
        await openSettings(page);

        const unsavedBar = page.locator(
            '[data-test-id="settings-unsaved-bar"]'
        );
        await expect(unsavedBar).toBeHidden();

        const themeGroup = page.locator(
            '[data-test-id="select-theme"][role="radiogroup"]'
        );
        await themeGroup
            .getByRole('radio', { name: 'Dark', exact: true })
            .click();
        await expect(unsavedBar).toBeVisible();

        // The staged edit belongs to the page, not the section — moving to
        // another section page must keep the bar (and the pending change).
        await openSettingsSection(page, 'playback');
        await expect(unsavedBar).toBeVisible();

        await page.locator('[data-test-id="discard-settings"]').click();
        await expect(unsavedBar).toBeHidden();

        await openSettingsSection(page, 'general');
        await expect(
            themeGroup.getByRole('radio', { name: 'System', exact: true })
        ).toHaveAttribute('aria-checked', 'true');
    });

    test('@settings @web Leaving with unsaved edits asks for confirmation', async ({
        page,
    }) => {
        await openSettings(page);

        const themeGroup = page.locator(
            '[data-test-id="select-theme"][role="radiogroup"]'
        );
        await themeGroup
            .getByRole('radio', { name: 'Dark', exact: true })
            .click();

        // Trying to leave the settings area surfaces the dialog.
        await page
            .getByRole('navigation')
            .getByRole('link', { name: 'Dashboard', exact: true })
            .click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // Keep editing: navigation is cancelled, the edit survives.
        await dialog.locator('[data-test-id="unsaved-dialog-stay"]').click();
        await expect(dialog).toBeHidden();
        await expect(page).toHaveURL(/\/workspace\/settings\/general$/);
        await expect(
            page.locator('[data-test-id="settings-unsaved-bar"]')
        ).toBeVisible();

        // Leave without saving: the staged edit is discarded.
        await page
            .getByRole('navigation')
            .getByRole('link', { name: 'Dashboard', exact: true })
            .click();
        await page
            .getByRole('dialog')
            .locator('[data-test-id="unsaved-dialog-discard"]')
            .click();
        await page.waitForURL(/\/workspace\/dashboard$/);

        await openSettings(page);
        await expect(
            themeGroup.getByRole('radio', { name: 'System', exact: true })
        ).toHaveAttribute('aria-checked', 'true');
    });

    test('@settings @web Save-and-leave persists the staged edit', async ({
        page,
    }) => {
        await openSettings(page);

        const themeGroup = page.locator(
            '[data-test-id="select-theme"][role="radiogroup"]'
        );
        await themeGroup
            .getByRole('radio', { name: 'Dark', exact: true })
            .click();

        await page
            .getByRole('navigation')
            .getByRole('link', { name: 'Dashboard', exact: true })
            .click();
        await page
            .getByRole('dialog')
            .locator('[data-test-id="unsaved-dialog-save"]')
            .click();
        await page.waitForURL(/\/workspace\/dashboard$/);

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
