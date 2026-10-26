import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function openSection(page: Page, section = 'general') {
    await page.goto(`/workspace/settings/${section}`);
    await expect(page.locator('.settings-container')).toBeVisible();
}

async function expectRovingGroup(group: Locator, selected: Locator) {
    await expect(selected).toHaveAttribute('aria-checked', 'true');
    await expect(selected).toHaveAttribute('tabindex', '0');
    await expect(group.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);
}

test('@settings @web radio choices follow arrows, Home/End and Discard', async ({
    page,
}) => {
    await openSection(page);
    const group = page.locator('[data-test-id="select-theme"]');
    const light = group.getByRole('radio', { name: 'Light', exact: true });
    const dark = group.getByRole('radio', { name: 'Dark', exact: true });
    await light.click();
    await light.press('ArrowRight');
    await expectRovingGroup(group, dark);
    await expect(dark).toBeFocused();
    await dark.press('Home');
    await expectRovingGroup(group, light);
    await light.press('End');
    const system = group.getByRole('radio', { name: 'System', exact: true });
    await expectRovingGroup(group, system);
    await system.press('ArrowRight');
    await expectRovingGroup(group, light);
    await page.locator('[data-test-id="discard-settings"]').click();
    await expectRovingGroup(group, system);

    const covers = page.locator('[data-test-id="select-cover-size"]');
    const medium = covers.getByRole('radio', { name: 'Medium', exact: true });
    await medium.press('ArrowDown');
    await expectRovingGroup(
        covers,
        covers.getByRole('radio', { name: 'Large', exact: true })
    );
    await page.locator('[data-test-id="discard-settings"]').click();
    await page.locator('[data-test-id="settings-section-epg"]').click();
    const guide = page.locator('[data-test-id="select-epg-view-mode"]');
    await guide
        .getByRole('radio', { name: 'Timeline', exact: true })
        .press('ArrowRight');
    await expectRovingGroup(
        guide,
        guide.getByRole('radio', { name: 'List', exact: true })
    );
});

test('@sources @web import methods keep one tab stop and select with arrows', async ({
    page,
}) => {
    await page.goto('/');
    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    const group = page.getByRole('radiogroup', { name: 'Connection method' });
    const first = group.getByRole('radio', { name: /^M3U URL/ });
    await first.press('ArrowRight');
    const file = group.getByRole('radio', { name: /^M3U file/ });
    await expectRovingGroup(group, file);
    await expect(file).toBeFocused();
    await file.press('End');
    await expectRovingGroup(
        group,
        group.getByRole('radio', { name: /^Auto-detect/ })
    );
    await group
        .getByRole('radio', { name: /^Auto-detect/ })
        .press('ArrowRight');
    await expectRovingGroup(group, first);
});

test('@settings @web parental switch has its visible action name', async ({
    page,
}) => {
    await openSection(page, 'parental');
    await expect(
        page.getByRole('switch', { name: 'Enable parental lock', exact: true })
    ).toBeVisible();
});

for (const theme of ['Light', 'Dark'] as const) {
    test(`@settings @web ${theme} ordinary actions share the kit, including disabled controls`, async ({
        page,
    }) => {
        await openSection(page);
        await page.getByRole('radio', { name: theme, exact: true }).click();
        await page.locator('[data-test-id="save-settings"]').click();
        await page.locator('[data-test-id="settings-section-backup"]').click();
        const importButton = page.getByRole('button', {
            name: 'Import',
            exact: true,
        });
        await expect(importButton).toHaveCSS('border-top-left-radius', '10px');
        await expect(importButton).toHaveCSS('height', '40px');
        await expect(importButton).toHaveCSS('border-top-style', 'none');
        await importButton.hover();
        await importButton.press('Tab');
        await expect(
            page.getByRole('button', { name: 'Export', exact: true })
        ).toBeFocused();
        await page.locator('[data-test-id="settings-section-tmdb"]').click();
        const clear = page.getByRole('button', {
            name: 'Clear cache',
            exact: true,
        });
        await expect(clear).toBeDisabled();
        await expect(clear).toHaveCSS('border-top-left-radius', '10px');
        await expect(clear).toHaveCSS('opacity', '0.4');
    });
}
