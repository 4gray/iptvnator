import type { Page } from '@playwright/test';
import { expect } from './electron-test-fixtures';

// Steps that put content on the dashboard: favourites from the Live TV list
// and from a detail page, and the way back from that detail page.

export async function goBackFromDetail(page: Page): Promise<void> {
    // Return to the list: the header's Back is route-level in browse and
    // watch alike (closing the player is the bar's own Close button).
    const backButton = page.getByTestId('workspace-header-back');

    await expect(backButton).toBeVisible({ timeout: 20000 });
    try {
        await backButton.click({ timeout: 5000 });
    } catch {
        await backButton.evaluate((button: HTMLButtonElement) =>
            button.click()
        );
    }
}

// By accessible name, not class: the Xtream movie detail's favorite control is
// an icon-only button that carries its label in aria-label, while series and
// Stalker details still use the labeled variant. This matches both.
export async function addCurrentDetailToFavorites(page: Page): Promise<void> {
    const addButton = page
        .getByRole('button', { name: /add to favorites/i })
        .first();

    await expect(addButton).toBeVisible({ timeout: 20000 });
    await addButton.click();
    await expect(
        page.getByRole('button', { name: /remove from favorites/i }).first()
    ).toBeVisible({
        timeout: 20000,
    });
}

export async function toggleFavoriteForChannel(
    page: Page,
    title: string
): Promise<void> {
    const item = page
        .locator('[data-test-id="channel-item"]')
        .filter({ hasText: title })
        .first();

    await expect(item).toBeVisible({ timeout: 20000 });
    await item.hover();
    await item.locator('.favorite-button').first().click();
    await expect(item.locator('.favorite-button mat-icon').first()).toHaveText(
        /star/
    );
}
