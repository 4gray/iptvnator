import { expect, Locator, Page } from '@playwright/test';

/**
 * Wait until keyboard focus has entered the open `mat-menu`, and return it.
 *
 * Material moves focus to the first item after the next render, which the
 * zoneless scheduler runs on a later task than the keydown that opened the
 * menu. The panel is visible before that, so a navigation key sent as soon
 * as it appears still reaches the trigger and the menu never sees it.
 */
export async function waitForMenuFocus(page: Page): Promise<Locator> {
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect
        .poll(
            () => menu.evaluate((el) => el.contains(document.activeElement)),
            { message: 'focus inside the open menu' }
        )
        .toBe(true);
    return menu;
}
