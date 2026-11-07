import type { Page } from '@playwright/test';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    restartElectronApp,
    saveSettings,
    test,
} from './electron-test-fixtures';
import { expectTextContrast } from './theme-contrast';

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
    return page
        .getByTestId('select-theme')
        .getByTestId(`${theme.replace(/-/g, '_').toUpperCase()}_THEME`);
}

async function expectTheme(page: Page, theme: Preset) {
    const body = page.locator('body');
    const dark = theme !== 'light' && theme !== 'cream';
    await expect(body).toHaveAttribute('data-app-theme', theme);
    await expect(body).toHaveClass(dark ? /dark-theme/ : /light-theme/);
    await expect(body).not.toHaveClass(dark ? /light-theme/ : /dark-theme/);
}

test.describe('Electron theme presets', () => {
    test('@theme @settings @electron previews every preset and discards to the saved choice', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await openSettings(page);
            await openSettingsSection(page, 'appearance');
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
                    await page.getByTestId('discard-settings').click();
                    await expectTheme(page, 'mocha');
                    await expect(themeOption(page, 'mocha')).toHaveAttribute(
                        'aria-checked',
                        'true'
                    );
                }
            }
        } finally {
            await closeElectronApp(app);
        }
    });

    for (const preset of [
        'cream',
        'mocha',
        'night-owl',
        'black-oled',
    ] as const) {
        test(`@theme @settings @persistence @electron saves ${preset} across a process restart`, async ({
            dataDir,
        }) => {
            let app = await launchElectronApp(dataDir);
            try {
                await openSettings(app.mainWindow);
                await openSettingsSection(app.mainWindow, 'appearance');
                await themeOption(app.mainWindow, preset).click();
                await saveSettings(app.mainWindow);
                app = await restartElectronApp(app, dataDir);
                await expectTheme(app.mainWindow, preset);
                await openSettings(app.mainWindow);
                await openSettingsSection(app.mainWindow, 'appearance');
                await expect(
                    themeOption(app.mainWindow, preset)
                ).toHaveAttribute('aria-checked', 'true');
            } finally {
                await closeElectronApp(app);
            }
        });
    }

    test('@theme @settings @electron follows OS changes only in System and restores Mocha on discard', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await page.emulateMedia({ colorScheme: 'light' });
            await openSettings(page);
            await openSettingsSection(page, 'appearance');
            await expectTheme(page, 'light');
            await themeOption(page, 'mocha').click();
            await saveSettings(page);
            await page.emulateMedia({ colorScheme: 'dark' });
            await expectTheme(page, 'mocha');

            await themeOption(page, 'system').click();
            await expectTheme(page, 'dark');
            await page.emulateMedia({ colorScheme: 'light' });
            await expectTheme(page, 'light');
            await page.getByTestId('discard-settings').click();
            await expectTheme(page, 'mocha');
            await page.emulateMedia({ colorScheme: 'dark' });
            await expectTheme(page, 'mocha');
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@theme @settings @electron restores saved System and keeps explicit presets independent of the OS', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await openSettings(page);
            await openSettingsSection(page, 'appearance');
            await themeOption(page, 'system').click();
            // Default is already System; save an explicit preset first.
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
                await page.getByTestId('discard-settings').click();
                await expectTheme(page, 'dark');
                await expect(themeOption(page, 'system')).toHaveAttribute(
                    'aria-checked',
                    'true'
                );
                await page.emulateMedia({ colorScheme: 'light' });
                await expectTheme(page, 'light');
            }
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@theme @settings @accessibility @electron keeps decorative previews out of keyboard navigation', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await openSettings(page);
            await openSettingsSection(page, 'appearance');
            const group = page.getByTestId('select-theme');
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
            ).toEqual(
                presets.map(() => ({ hidden: 'true', focusable: false }))
            );

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
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@theme @settings @accessibility @electron renders readable settings and Material overlays in every preset', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await openSettings(page);
            await openSettingsSection(page, 'appearance');
            for (const preset of presets) {
                await themeOption(page, preset).click();
                await expectTheme(page, preset);
                await expectTextContrast(
                    themeOption(page, preset).locator('.theme-palette__label')
                );
                await openSettingsSection(page, 'general');
                await expectTextContrast(page.locator('#language-label'));
                await expectTextContrast(
                    page.locator('[data-setting-id="language"] p')
                );
                const select = page.getByTestId('select-language');
                await expectTextContrast(
                    select.locator('.mat-mdc-select-value-text')
                );
                await select.click();
                const selected = page.locator(
                    'mat-option[aria-selected="true"] .mdc-list-item__primary-text'
                );
                await expectTextContrast(selected);
                await page.keyboard.press('Escape');
                await expect(selected).toBeHidden();
                await openSettingsSection(page, 'appearance');
            }
        } finally {
            await closeElectronApp(app);
        }
    });
});

test('@theme @settings @electron palette labels fit a narrow desktop settings pane', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);
    try {
        const page = app.mainWindow;
        await openSettings(page);
        await page.getByTestId('select-language').click();
        await page
            .getByRole('option', { name: 'Русский', exact: true })
            .click();
        await openSettingsSection(page, 'appearance');
        await app.electronApp.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            window.setMinimumSize(500, 500);
            window.setContentSize(700, 1000);
        });
        await expect
            .poll(() => page.evaluate(() => window.innerWidth))
            .toBe(700);
        const options = page.locator(
            '.theme-palette:not(.theme-palette--system)'
        );
        await expect(options).toHaveCount(6);
        await expect
            .poll(() =>
                page
                    .locator('.theme-picker')
                    .evaluate(
                        (el) =>
                            getComputedStyle(el).gridTemplateColumns.split(' ')
                                .length
                    )
            )
            .toBe(2);
        await expect
            .poll(() =>
                page.locator('.theme-picker').evaluate((el) => {
                    const bounds = el.getBoundingClientRect();
                    return (
                        bounds.left >= 0 && bounds.right <= window.innerWidth
                    );
                })
            )
            .toBe(true);
        for (const direction of ['ltr', 'rtl'] as const) {
            await page.locator('.theme-picker').evaluate((el, dir) => {
                el.setAttribute('dir', dir);
            }, direction);
            for (const option of await options.all()) {
                await expect
                    .poll(() =>
                        option.evaluate((el) => {
                            const labelElement = el.querySelector<HTMLElement>(
                                '.theme-palette__label'
                            );
                            const checkElement = el.querySelector(
                                '.theme-palette__check'
                            );
                            if (!labelElement || !checkElement) return false;
                            const label = labelElement.getBoundingClientRect();
                            const check = checkElement.getBoundingClientRect();
                            const card = el.getBoundingClientRect();
                            const separated =
                                getComputedStyle(el).direction === 'rtl'
                                    ? check.right <= label.left - 2
                                    : label.right <= check.left - 2;
                            return (
                                separated &&
                                label.left >= card.left + 5 &&
                                label.right <= card.right - 5 &&
                                check.left >= card.left + 5 &&
                                check.right <= card.right - 5 &&
                                labelElement.scrollWidth <=
                                    labelElement.clientWidth
                            );
                        })
                    )
                    .toBe(true);
            }
        }
    } finally {
        await closeElectronApp(app);
    }
});
