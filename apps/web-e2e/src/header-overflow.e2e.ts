import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { expect, test } from './pwa-mock.fixture';
import {
    addM3uUrlPlaylist,
    addXtreamPortal,
    interceptPwaProviderRequests,
} from './sources-pwa.helpers';

/**
 * Workspace header at phone width (PWA), audit follow-up points 1, 4, 5:
 *
 *   1. Priority+ overflow: actions that do not fit move into "More actions",
 *      never a menu of one, and the header row never spills past its edge.
 *   4. The PWA has no global search, so the dashboard shows no search field
 *      (never a disabled one); the palette keeps a pointer way in.
 *   5. Keyboard shortcuts left the header; Settings opens the same dialog.
 *
 * Tag: @header — run only this spec with:
 *   pnpm nx run web-e2e:e2e-ci--src/header-overflow.e2e.ts
 */

const PHONE = { width: 375, height: 812 };
const SCREENSHOTS = join(
    process.cwd(),
    'dist/.playwright/apps/web-e2e/screenshots/header-overflow'
);
const PIN = '2468';

async function expectHeaderFits(page: Page): Promise<void> {
    const header = page.locator('app-workspace-shell-header .workspace-header');
    await expect
        .poll(() =>
            header.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const spill = Array.from(element.querySelectorAll('button'))
                    .filter((button) => button.getClientRects().length > 0)
                    .map((button) => button.getBoundingClientRect())
                    .filter(
                        (rect) =>
                            rect.left < bounds.left - 1 ||
                            rect.right > bounds.right + 1
                    ).length;
                return {
                    spill,
                    overflow: element.scrollWidth - element.clientWidth,
                };
            })
        )
        .toEqual({ spill: 0, overflow: 0 });
}

async function enableParentalLock(page: Page): Promise<void> {
    await page.locator('a[href$="/workspace/settings"]').click();
    await page.waitForURL(/\/workspace\/settings\/general$/);
    await page.locator('[data-test-id="settings-section-parental"]').click();
    const toggle = page.locator(
        '[data-test-id="parental-lock-enabled"] button[role="switch"]'
    );
    await toggle.click();
    await page.locator('[data-test-id="parental-lock-pin"]').fill(PIN);
    await page.locator('[data-test-id="parental-lock-pin-confirm"]').fill(PIN);
    await page.locator('[data-test-id="parental-lock-pin-submit"]').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
}

test.describe('workspace header on a phone', () => {
    test.beforeEach(async ({ page, pwaMocks }) => {
        await interceptPwaProviderRequests(page);
        await page.goto('/');
        await addXtreamPortal(page, 'Header Overflow Portal', pwaMocks);
    });

    test('@header @mobile @xtream overflowed actions move into one menu of two or more', async ({
        page,
    }) => {
        await enableParentalLock(page);
        // In-app navigation: a reload right after the PIN is saved could
        // race the settings write and come back with the lock off.
        await page
            .locator('app-workspace-shell-rail')
            .getByRole('link', { name: 'Live TV', exact: true })
            .click();
        await page.waitForURL(/\/live/);
        await page.locator('.context-panel .category-item').first().click();
        await expect(
            page.locator('app-live-stream-layout .sidebar')
        ).toBeVisible();

        await page.setViewportSize(PHONE);
        await expectHeaderFits(page);

        const trigger = page.locator('[data-test-id="header-overflow-menu"]');
        await expect(trigger).toBeVisible();
        // Keyboard: Enter opens the menu on its first row, Escape returns
        // focus to the trigger.
        await trigger.focus();
        await page.keyboard.press('Enter');
        const panel = page.locator('.mat-mdc-menu-panel');
        const items = panel.locator('[mat-menu-item]');
        // No channel plays yet, so the guide row keeps its disabled state
        // and focus starts on the first row that can run.
        await expect(
            panel.locator('[data-test-id="xtream-epg-guide-menu-item"]')
        ).toBeDisabled();
        await expect(
            panel.locator('[mat-menu-item]:not([disabled])').first()
        ).toBeFocused();
        await expect.poll(() => items.count()).toBeGreaterThanOrEqual(2);
        // Every moved action keeps its name, and nothing is shown twice.
        for (const testId of [
            'header-parental-lock',
            'header-add-source',
        ] as const) {
            const inline = page.locator(`[data-test-id="${testId}"]`);
            const inMenu = page.locator(`[data-test-id="${testId}-menu-item"]`);
            expect((await inline.count()) + (await inMenu.count())).toBe(1);
        }
        await expect
            .poll(() => panel.evaluate((el) => getComputedStyle(el).opacity))
            .toBe('1');
        await page.screenshot({ path: join(SCREENSHOTS, 'phone-live.png') });
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();

        // Back at desktop width everything fits inline again.
        await page.setViewportSize({ width: 1280, height: 800 });
        await expect(trigger).toBeHidden();
        await expect(
            page.locator('[data-test-id="header-parental-lock"]')
        ).toBeVisible();
    });

    test('@header @settings Settings opens the keyboard shortcuts dialog', async ({
        page,
    }) => {
        await page.locator('a[href$="/workspace/settings"]').click();
        await page.waitForURL(/\/workspace\/settings\/general$/);
        await page
            .locator('[data-test-id="settings-open-keyboard-shortcuts"]')
            .click();

        const dialog = page.getByRole('dialog');
        await expect(
            dialog.getByRole('heading', { name: 'Keyboard shortcuts' })
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
    });
});

test.describe('PWA dashboard without an Xtream source', () => {
    test.beforeEach(async ({ page }) => {
        await interceptPwaProviderRequests(page);
        await page.goto('/');
        await addM3uUrlPlaylist(page, 'Header Overflow List');
    });

    test('@header @mobile @m3u the PWA dashboard leaves out the search field', async ({
        page,
    }) => {
        await page.setViewportSize(PHONE);
        await page.goto('/workspace/dashboard');
        await expect(page.locator('.app-rail')).toBeVisible();

        const header = page.locator('app-workspace-shell-header');
        await expect(header.locator('input[type="search"]')).toHaveCount(0);
        await expectHeaderFits(page);
        await page.screenshot({
            path: join(SCREENSHOTS, 'phone-dashboard.png'),
        });

        await header.locator('[data-test-id="header-command-palette"]').click();
        await expect(
            page.locator('.workspace-command-palette-overlay')
        ).toBeVisible();
    });
});
