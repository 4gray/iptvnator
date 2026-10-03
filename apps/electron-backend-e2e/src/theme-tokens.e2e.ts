import type { Locator, Page } from '@playwright/test';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    test,
} from './electron-test-fixtures';
import { applyTheme } from './theme-contrast';

/**
 * WCAG contrast between an element's outline colour and the fill inside it,
 * both composited over the backgrounds behind the field.
 */
async function outlineContrast(
    outline: Locator,
    fillSelector: string
): Promise<number> {
    return outline.evaluate((el, selector) => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const field = el.closest('mat-form-field')!;
        const layers = [
            getComputedStyle(field.querySelector(selector)!).backgroundColor,
        ];
        for (let node = field.parentElement; node; node = node.parentElement) {
            layers.unshift(getComputedStyle(node).backgroundColor);
        }
        const paint = (colors: string[]) => {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, 1, 1);
            for (const color of colors) {
                ctx.fillStyle = color;
                ctx.fillRect(0, 0, 1, 1);
            }
            const [r, g, b] = Array.from(
                ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)
            ).map((channel) => {
                const c = channel / 255;
                return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const fill = paint(layers);
        const line = paint([...layers, getComputedStyle(el).borderTopColor]);
        return (Math.max(fill, line) + 0.05) / (Math.min(fill, line) + 0.05);
    }, fillSelector);
}

/** Resolves a CSS color (including var() and color-mix()) to rgb()/rgba(). */
async function resolveColor(page: Page, value: string): Promise<string> {
    return page.evaluate((css) => {
        const probe = document.createElement('div');
        probe.style.color = css;
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    }, value);
}

async function systemVariable(page: Page, name: string): Promise<string> {
    return page.evaluate(
        (variable) =>
            getComputedStyle(document.body).getPropertyValue(variable).trim(),
        name
    );
}

test.describe('Theme tokens', () => {
    test('@theme @electron declares Material system variables and applies app token overrides in both themes', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await openSettings(page);

            const surfaces: Record<string, string> = {};
            for (const theme of ['light', 'dark'] as const) {
                await applyTheme(page, theme);

                // The legacy define-theme config never emits these; app
                // styles that read them used to resolve to nothing.
                for (const variable of [
                    '--mat-sys-surface',
                    '--mat-sys-on-surface',
                    '--mat-sys-outline-variant',
                    '--mat-sys-error',
                    '--mat-sys-corner-medium',
                    '--mat-sys-body-medium',
                ]) {
                    expect(
                        await systemVariable(page, variable),
                        `${variable} in ${theme} theme`
                    ).not.toBe('');
                }
                surfaces[theme] = await systemVariable(
                    page,
                    '--mat-sys-surface'
                );

                // The dark surface belongs to the app host. Components that
                // carry `dark-theme` for its tokens (the fullscreen channel
                // panel, the diagnostic's alternative sources) keep their own.
                const backgrounds = await page.evaluate(() => {
                    const nested = document.createElement('div');
                    nested.className = 'dark-theme';
                    nested.style.background = 'rgb(22, 27, 36)';
                    document.body.appendChild(nested);
                    const result = {
                        nested: getComputedStyle(nested).backgroundColor,
                        body: getComputedStyle(document.body).backgroundColor,
                    };
                    nested.remove();
                    return result;
                });
                expect(backgrounds.nested, `nested in ${theme} theme`).toBe(
                    'rgb(22, 27, 36)'
                );
                if (theme === 'dark') {
                    expect(backgrounds.body).toBe(
                        await resolveColor(page, 'var(--mat-sys-surface)')
                    );
                }

                // Form-field overrides must reach Material's --mat-* tokens
                // (the retired --mdc-* names were ignored): the outline takes
                // the app's 10px shape instead of the 4px M3 default.
                const outline = page
                    .locator(
                        'mat-form-field.mat-form-field-appearance-outline .mdc-notched-outline__leading'
                    )
                    .first();
                await expect(outline).toBeVisible();
                await expect
                    .poll(() =>
                        outline.evaluate(
                            (el) => getComputedStyle(el).borderTopLeftRadius
                        )
                    )
                    .toBe('10px');
                // The outline is the field's only boundary (WCAG 1.4.11).
                expect(
                    await outlineContrast(
                        outline,
                        '.mat-mdc-text-field-wrapper'
                    ),
                    `field outline contrast in ${theme} theme`
                ).toBeGreaterThanOrEqual(3);

                // A floated label inherits the field's text size and renders
                // at 75% of it; it must stay legible.
                const floated = page
                    .locator('mat-form-field .mdc-floating-label--float-above')
                    .first();
                await expect(floated).toBeVisible();
                expect(
                    await floated.evaluate((el) => {
                        const style = getComputedStyle(el);
                        const scale = new DOMMatrixReadOnly(style.transform).a;
                        return parseFloat(style.fontSize) * scale;
                    }),
                    `floated label size in ${theme} theme`
                ).toBeGreaterThanOrEqual(11);

                // The typography tokens carry the font stack through
                // --app-font-family. A dangling var() voids the whole `font`
                // shorthand; body text would still inherit the same family,
                // so check the token's own size and weight.
                expect(
                    await page.evaluate(() => {
                        const probe = document.createElement('span');
                        probe.style.font = 'var(--mat-sys-label-small)';
                        document.body.appendChild(probe);
                        const style = getComputedStyle(probe);
                        const font = {
                            family: style.fontFamily,
                            size: Math.round(parseFloat(style.fontSize)),
                            weight: style.fontWeight,
                        };
                        probe.remove();
                        return font;
                    }),
                    `label-small typography in ${theme} theme`
                ).toEqual({
                    family: expect.stringMatching(/^"?DM Sans"?,/),
                    size: 11,
                    weight: '500',
                });
            }
            expect(surfaces['light']).not.toBe(surfaces['dark']);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@theme @electron destructive actions name the action and use the error color', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await openSettings(page);
            await openSettingsSection(page, 'epg');

            for (const theme of ['light', 'dark'] as const) {
                await applyTheme(page, theme);
                const error = await resolveColor(page, 'var(--mat-sys-error)');
                const trigger = page.getByRole('button', {
                    name: 'Clear EPG data',
                    exact: true,
                });
                // The `warn` color input was a no-op with M3: the trigger
                // rendered in the primary color.
                await expect
                    .poll(() =>
                        trigger.evaluate((el) => getComputedStyle(el).color)
                    )
                    .toBe(error);
                await trigger.click();

                const dialog = page.locator('mat-dialog-container');
                await expect(dialog).toBeVisible();
                await expect(
                    dialog.getByRole('button', { name: 'Yes' })
                ).toHaveCount(0);
                const confirm = dialog.getByTestId('confirm-dialog-confirm');
                await expect(confirm).toHaveText('Clear EPG data');
                await expect(confirm).toHaveClass(/app-destructive-button/);
                await expect
                    .poll(() =>
                        confirm.evaluate(
                            (el) => getComputedStyle(el).backgroundColor
                        )
                    )
                    .toBe(error);

                await dialog
                    .getByRole('button', { name: 'Cancel', exact: true })
                    .click();
                await expect(dialog).toBeHidden();
            }
        } finally {
            await closeElectronApp(app);
        }
    });
});
