import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const presets = [
    'light',
    'dark',
    'cream',
    'mocha',
    'night-owl',
    'black-oled',
] as const;
type Preset = (typeof presets)[number];

function themeOption(page: Page, theme: Preset | 'system') {
    return page.locator(
        `[data-test-id="select-theme"] [data-test-id="${theme.replace(/-/g, '_').toUpperCase()}_THEME"]`
    );
}

async function expectTheme(page: Page, theme: Preset) {
    const body = page.locator('body');
    const dark = theme !== 'light' && theme !== 'cream';
    await expect(body).toHaveAttribute('data-app-theme', theme);
    await expect(body).toHaveClass(dark ? /dark-theme/ : /light-theme/);
    await expect(body).not.toHaveClass(dark ? /light-theme/ : /dark-theme/);
}

async function saveSettings(page: Page) {
    const save = page.locator('[data-test-id="save-settings"]');
    await save.click({ noWaitAfter: true });
    await expect(save).toBeHidden();
}

async function openSettings(page: Page) {
    await page.locator('a[href$="/workspace/settings"]').click();
    await page.waitForURL(/\/workspace\/settings\/general$/);
    await page.locator('[data-test-id="settings-section-appearance"]').click();
    await expect(page.locator('[data-test-id="select-theme"]')).toBeVisible();
}

test.describe('PWA theme presets', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await openSettings(page);
    });

    test('@theme @settings @persistence @web shares staged Appearance and General edits through Save and Discard', async ({
        page,
    }) => {
        const section = (id: string) =>
            page.locator(`[data-test-id="settings-section-${id}"]`);
        const dirty = (id: string) =>
            page.locator(`[data-test-id="settings-section-dirty-${id}"]`);
        const message = page.locator(
            '[data-test-id="settings-unsaved-message"]'
        );
        const prefix = page
            .locator('[data-test-id="strip-country-prefix-toggle"]')
            .getByRole('switch');
        const titles = page
            .locator('[data-test-id="cover-titles-toggle"]')
            .getByRole('switch');
        await themeOption(page, 'light').click();
        await saveSettings(page);

        await section('general').click();
        await expect(page.locator('[data-setting-id="theme"]')).toHaveCount(0);
        const savedPrefix = await prefix.isChecked();
        await prefix.click();
        await section('appearance').click();
        await themeOption(page, 'night-owl').click();
        await page.locator('[data-test-id="cover-size-large"]').click();
        await titles.click();
        await expect(message).toHaveText('4 unsaved changes');
        await expect(dirty('general')).toBeVisible();
        await expect(dirty('appearance')).toBeVisible();
        await section('general').click();
        await expect(prefix).toBeChecked({ checked: !savedPrefix });
        await expectTheme(page, 'night-owl');
        await section('appearance').click();
        await expect(titles).not.toBeChecked();
        await page.locator('[data-test-id="discard-settings"]').click();
        await expectTheme(page, 'light');
        await expect(titles).toBeChecked();
        await expect(dirty('appearance')).toHaveCount(0);
        await expect(dirty('general')).toHaveCount(0);
        await section('general').click();
        await expect(prefix).toBeChecked({ checked: savedPrefix });

        await prefix.click();
        await section('appearance').click();
        await themeOption(page, 'night-owl').click();
        await page.locator('[data-test-id="cover-size-large"]').click();
        await titles.click();
        await section('general').click();
        await page.keyboard.press('Control+s');
        await expect(message).toBeHidden();
        await page.reload();
        await expectTheme(page, 'night-owl');
        await openSettings(page);
        await expect(titles).not.toBeChecked();
        await expect(
            page.locator('[data-test-id="cover-size-large"]')
        ).toHaveAttribute('aria-checked', 'true');
        await section('general').click();
        await expect(prefix).toBeChecked({ checked: !savedPrefix });
    });

    test('@theme @settings @search @web reveals Appearance rows from settings search and the command palette', async ({
        page,
    }) => {
        const search = page.locator(
            'app-workspace-shell-header input[type="search"]'
        );
        for (const [term, id] of [
            ['night owl', 'theme'],
            ['cover size', 'cover-size'],
            ['cover titles', 'cover-titles'],
        ]) {
            await page
                .locator('[data-test-id="settings-section-general"]')
                .click();
            await search.fill(term);
            await page
                .locator(`[data-test-id="settings-search-result-${id}"]`)
                .click();
            await expect(page).toHaveURL(/\/workspace\/settings\/appearance$/);
            const row = page.locator(`[data-setting-id="${id}"]`);
            await expect(row).toBeFocused();
            await expect(row).toHaveClass(/setting-item--revealed/);
        }
        await page.keyboard.press('Control+k');
        const palette = page.locator('.workspace-command-palette-overlay');
        await palette.locator('input[type="search"]').fill('night owl');
        await palette
            .locator('.palette-command', { hasText: /theme/i })
            .first()
            .click();
        await expect(page).toHaveURL(/\/workspace\/settings\/appearance$/);
        await expect(page.locator('[data-setting-id="theme"]')).toBeFocused();
    });

    test('@theme @settings @pwa @web previews all six presets and discards to saved Mocha', async ({
        page,
    }) => {
        await themeOption(page, 'mocha').click();
        await saveSettings(page);
        for (const preset of presets) {
            await themeOption(page, preset).click();
            await expectTheme(page, preset);
            await expect(themeOption(page, preset)).toHaveAttribute(
                'aria-checked',
                'true'
            );
            if (preset !== 'mocha') {
                await page.locator('[data-test-id="discard-settings"]').click();
                await expectTheme(page, 'mocha');
                await expect(themeOption(page, 'mocha')).toHaveAttribute(
                    'aria-checked',
                    'true'
                );
            }
        }
    });

    for (const preset of [
        'cream',
        'mocha',
        'night-owl',
        'black-oled',
    ] as const) {
        test(`@theme @settings @persistence @pwa @web saves ${preset} across reload`, async ({
            page,
        }) => {
            await themeOption(page, preset).click();
            await saveSettings(page);
            await page.reload();
            await expectTheme(page, preset);
            await openSettings(page);
            await expect(themeOption(page, preset)).toHaveAttribute(
                'aria-checked',
                'true'
            );
        });
    }

    test('@theme @settings @pwa @web follows the OS in System and restores explicit Mocha on discard', async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await expectTheme(page, 'light');
        await themeOption(page, 'mocha').click();
        await saveSettings(page);
        await page.emulateMedia({ colorScheme: 'dark' });
        await expectTheme(page, 'mocha');

        await themeOption(page, 'system').click();
        await expectTheme(page, 'dark');
        await page.emulateMedia({ colorScheme: 'light' });
        await expectTheme(page, 'light');
        await page.locator('[data-test-id="discard-settings"]').click();
        await expectTheme(page, 'mocha');
        await page.emulateMedia({ colorScheme: 'dark' });
        await expectTheme(page, 'mocha');
    });

    test('@theme @settings @pwa @web restores saved System and keeps explicit presets independent of the OS', async ({
        page,
    }) => {
        await themeOption(page, 'light').click();
        await saveSettings(page);
        await themeOption(page, 'system').click();
        await saveSettings(page);
        for (const preset of presets) {
            await themeOption(page, preset).click();
            for (const colorScheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme });
                await expectTheme(page, preset);
            }
            await page.locator('[data-test-id="discard-settings"]').click();
            await expectTheme(page, 'dark');
            await expect(themeOption(page, 'system')).toHaveAttribute(
                'aria-checked',
                'true'
            );
            await page.emulateMedia({ colorScheme: 'light' });
            await expectTheme(page, 'light');
        }
    });

    test('@theme @settings @accessibility @pwa @web supports radio arrows and Home/End with six decorative previews', async ({
        page,
    }) => {
        const group = page.locator('[data-test-id="select-theme"]');
        await expect(group).toHaveAttribute('role', 'radiogroup');
        await expect(group.getByRole('radio')).toHaveCount(7);
        const previews = group.locator('[data-theme-preview]');
        await expect(previews).toHaveCount(6);
        expect(
            await previews.evaluateAll((elements) =>
                elements.map((el) => ({
                    hidden: el.getAttribute('aria-hidden'),
                    focusable:
                        el.querySelector('button, a, input, [tabindex]') !==
                        null,
                }))
            )
        ).toEqual(presets.map(() => ({ hidden: 'true', focusable: false })));

        await themeOption(page, 'system').focus();
        for (const [key, selected] of [
            ['Home', 'light'],
            ['ArrowRight', 'dark'],
            ['ArrowDown', 'cream'],
            ['ArrowRight', 'mocha'],
            ['ArrowRight', 'night-owl'],
            ['ArrowDown', 'black-oled'],
            ['End', 'system'],
            ['ArrowRight', 'light'],
            ['ArrowLeft', 'system'],
        ] as const) {
            await page.keyboard.press(key);
            await expect(themeOption(page, selected)).toBeFocused();
            await expect(themeOption(page, selected)).toHaveAttribute(
                'aria-checked',
                'true'
            );
            await expect(
                group.locator('[role="radio"][tabindex="0"]')
            ).toHaveCount(1);
        }
    });
});
