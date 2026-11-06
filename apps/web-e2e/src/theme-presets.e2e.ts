import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const presets = ['light', 'dark', 'cream', 'mocha'] as const;
type Preset = (typeof presets)[number];

function themeOption(page: Page, theme: Preset | 'system') {
    return page.locator(
        `[data-test-id="select-theme"] [data-test-id="${theme.toUpperCase()}_THEME"]`
    );
}

async function expectTheme(page: Page, theme: Preset) {
    const body = page.locator('body');
    const dark = theme === 'dark' || theme === 'mocha';
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
    await expect(page.locator('[data-test-id="select-theme"]')).toBeVisible();
}

test.describe('PWA theme presets', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await openSettings(page);
    });

    test('@theme @settings @pwa @web previews all four presets and discards to saved Mocha', async ({
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

    for (const preset of ['cream', 'mocha'] as const) {
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

    test('@theme @settings @accessibility @pwa @web supports radio arrows and Home/End with four decorative previews', async ({
        page,
    }) => {
        const group = page.locator('[data-test-id="select-theme"]');
        await expect(group).toHaveAttribute('role', 'radiogroup');
        await expect(group.getByRole('radio')).toHaveCount(5);
        const previews = group.locator('[data-theme-preview]');
        await expect(previews).toHaveCount(4);
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
