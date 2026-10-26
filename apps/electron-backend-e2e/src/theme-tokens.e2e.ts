import type { Locator, Page } from '@playwright/test';
import {
    closeElectronApp,
    createMutableTextServer,
    expect,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    test,
} from './electron-test-fixtures';
import { applyTheme } from './theme-contrast';

const epgFixtureXml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="guide-news">
    <display-name>Guide News</display-name>
  </channel>
  <programme start="20260328070000 +0000" stop="20260328080000 +0000" channel="guide-news">
    <title>Guide Bulletin</title>
  </programme>
</tv>
`;

/** An update the main process would announce; the card shows it as is. */
const availableUpdateStatus = {
    status: 'available',
    currentVersion: '0.0.0-e2e',
    latestVersion: '9.9.9',
    supportedSelfUpdate: true,
    manualDownloadUrl: 'https://example.invalid/releases',
    channel: 'stable',
    installedChannel: 'stable',
};

/** The surface, hairline and corner of a framed element. */
async function frame(locator: Locator) {
    return locator.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
            background: style.backgroundColor,
            border: style.borderTopColor,
            radius: style.borderTopLeftRadius,
        };
    });
}

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

/**
 * Resolves a CSS color (including var() and color-mix()) the way the given
 * property serializes it, so it compares with a computed `color` or
 * `backgroundColor`.
 */
async function resolveColor(
    page: Page,
    value: string,
    property: 'color' | 'backgroundColor' = 'color'
): Promise<string> {
    return page.evaluate(
        ({ css, prop }) => {
            const probe = document.createElement('div');
            probe.style[prop] = css;
            document.body.appendChild(probe);
            const color = getComputedStyle(probe)[prop];
            probe.remove();
            return color;
        },
        { css: value, prop: property }
    );
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
                // at 75% of it; it must stay legible. The settings selects
                // have no floating label any more (the row title names
                // them): the recording folder field on Playback keeps one,
                // and focusing it floats the label.
                await openSettingsSection(page, 'playback');
                await page.locator('#recordingFolder').focus();
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

    test('@theme @electron destructive actions name the action and use the danger tint', async ({
        dataDir,
    }) => {
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        try {
            await openSettings(page);
            await openSettingsSection(page, 'epg');

            for (const theme of ['light', 'dark'] as const) {
                await applyTheme(page, theme);
                const dangerText = await resolveColor(
                    page,
                    'var(--app-danger-text)'
                );
                const dangerSurface = await resolveColor(
                    page,
                    'var(--app-danger-surface)',
                    'backgroundColor'
                );
                const trigger = page.getByRole('button', {
                    name: 'Clear EPG data',
                    exact: true,
                });
                // The `warn` color input was a no-op with M3: the trigger
                // rendered in the primary color. The kit draws a destructive
                // button as a red tint, never a solid error fill, and the
                // outlined trigger carries the same tint as a filled one.
                await expect
                    .poll(() =>
                        trigger.evaluate((el) => getComputedStyle(el).color)
                    )
                    .toBe(dangerText);
                await expect
                    .poll(() =>
                        trigger.evaluate(
                            (el) => getComputedStyle(el).backgroundColor
                        )
                    )
                    .toBe(dangerSurface);
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
                    .toBe(dangerSurface);
                await expect
                    .poll(() =>
                        confirm.evaluate((el) => getComputedStyle(el).color)
                    )
                    .toBe(dangerText);

                await dialog
                    .getByRole('button', { name: 'Cancel', exact: true })
                    .click();
                await expect(dialog).toBeHidden();
            }
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@theme @electron floating panels and toasts share the dialog frame in both themes', async ({
        dataDir,
    }) => {
        const epgServer = await createMutableTextServer(epgFixtureXml, {
            contentType: 'application/xml; charset=utf-8',
            resourcePath: '/guide.xml',
        });
        try {
            await withFloatingSurfaces(dataDir, epgServer.resourceUrl);
        } finally {
            await epgServer.close();
        }
    });
});

/**
 * Launches the app with one guide source, shows the update notification and
 * measures both floating panels, the dialog and a toast in both themes.
 */
async function withFloatingSurfaces(
    dataDir: string,
    guideUrl: string
): Promise<void> {
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        await openSettings(page);
        await openSettingsSection(page, 'epg');
        await page.getByRole('button', { name: 'Add EPG source' }).click();
        await page.locator('.epg-source-row input').first().fill(guideUrl);
        const panel = page.locator('.epg-progress-panel');
        // A completed import leaves the panel five seconds later, so
        // each theme imports the source again right before measuring.
        const importGuide = async () => {
            await page.getByTestId('epg-source-refresh').click();
            await expect(
                panel.locator('.import-item.status-complete')
            ).toBeVisible();
        };

        // The update notification appears when the main process
        // announces an update on the renderer's status channel.
        await app.electronApp.evaluate(({ BrowserWindow }, status) => {
            for (const window of BrowserWindow.getAllWindows()) {
                window.webContents.send('APP_UPDATE:STATUS_CHANGED', status);
            }
        }, availableUpdateStatus);
        const card = page.getByTestId('app-update-notification');
        await expect(card).toBeVisible();

        for (const theme of ['light', 'dark'] as const) {
            await applyTheme(page, theme);
            await importGuide();
            const surface = await resolveColor(
                page,
                'var(--app-widget-bg)',
                'backgroundColor'
            );
            const hairline = await resolveColor(page, 'var(--app-line-strong)');
            const accent = await resolveColor(
                page,
                'var(--app-selection-color)',
                'backgroundColor'
            );

            // Both floating panels: the dialog's surface, the menu's
            // hairline, a 12px corner.
            for (const [name, floating] of [
                ['import panel', panel],
                ['update card', card],
            ] as const) {
                await expect
                    .poll(() => frame(floating), {
                        message: `${name} frame in ${theme} theme`,
                    })
                    .toEqual({
                        background: surface,
                        border: hairline,
                        radius: '12px',
                    });
            }
            // Header actions are the kit's 28px square ghost icon buttons.
            await expect
                .poll(() =>
                    panel.locator('.dismiss-all-btn').evaluate((el) => {
                        const style = getComputedStyle(el);
                        return {
                            width: style.width,
                            radius: style.borderTopLeftRadius,
                        };
                    })
                )
                .toEqual({ width: '28px', radius: '8px' });
            // The card's actions: the one accent button and a secondary
            // beside it, neither outlined.
            const download = page.getByTestId(
                'app-update-notification-download'
            );
            await expect
                .poll(() =>
                    download.evaluate(
                        (el) => getComputedStyle(el).backgroundColor
                    )
                )
                .toBe(accent);
            const releaseNotes = page.getByTestId(
                'app-update-notification-release-notes'
            );
            await expect(releaseNotes).not.toHaveClass(
                /mat-mdc-outlined-button/
            );
            expect(
                await releaseNotes.evaluate(
                    (el) => getComputedStyle(el).borderTopWidth
                )
            ).toBe('0px');

            // The dialog the panels are measured against, and the toast
            // its confirmation leaves behind.
            await page
                .getByRole('button', {
                    name: 'Clear EPG data',
                    exact: true,
                })
                .click();
            const dialogSurface = page.locator(
                'mat-dialog-container .mat-mdc-dialog-surface'
            );
            await expect(dialogSurface).toBeVisible();
            expect(
                await frame(dialogSurface),
                `dialog frame in ${theme} theme`
            ).toEqual({
                background: surface,
                border: hairline,
                radius: '16px',
            });
            await page
                .locator('mat-dialog-container')
                .getByTestId('confirm-dialog-confirm')
                .click();

            const toast = page.locator(
                '.mat-mdc-snack-bar-container .mat-mdc-snackbar-surface'
            );
            await expect(toast).toBeVisible();
            await expect
                .poll(() => frame(toast), {
                    message: `toast frame in ${theme} theme`,
                })
                .toEqual({
                    background: surface,
                    border: hairline,
                    radius: '10px',
                });
            expect(
                await toast
                    .locator('.mdc-snackbar__label')
                    .evaluate((el) => getComputedStyle(el).fontSize)
            ).toBe('13px');
            await expect(toast).toBeHidden({ timeout: 10_000 });
        }
    } finally {
        await closeElectronApp(app);
    }
}
