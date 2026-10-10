import type { Locator, Page, TestInfo } from '@playwright/test';
import {
    closeElectronApp,
    expect,
    goToDashboard,
    launchElectronApp,
    openSettings,
    openSources,
    saveSettings,
    test,
} from './electron-test-fixtures';
import { measureBackdropTextContrast } from './theme-contrast';

type Theme = 'light' | 'dark';

const THEMES: readonly Theme[] = ['dark', 'light'];
const COLOR_PROPERTIES = [
    'color',
    'background-color',
    'background-image',
    'border-top-color',
    'fill',
    'stroke',
    'box-shadow',
];

/** Every colour the subtree paints, keyed by element and pseudo-element. */
async function paintedColors(scope: Locator): Promise<Record<string, string>> {
    return scope.evaluate((root, properties) => {
        const colors: Record<string, string> = {};
        [root, ...Array.from(root.querySelectorAll('*'))].forEach(
            (element, index) => {
                const name = `${index}:${element.tagName.toLowerCase()}.${(
                    element.getAttribute('class') ?? ''
                )
                    .trim()
                    .replace(/\s+/g, '.')}`;
                for (const pseudo of ['', '::before']) {
                    const style = getComputedStyle(element, pseudo || null);
                    for (const property of properties) {
                        colors[`${name}${pseudo} ${property}`] =
                            style.getPropertyValue(property);
                    }
                }
            }
        );
        return colors;
    }, COLOR_PROPERTIES);
}

/** Lets entrance fades finish, so contrast reads the settled page. */
async function settleAnimations(page: Page): Promise<void> {
    await page.mouse.move(1, 1);
    await page.evaluate(() =>
        Promise.all(
            document
                .getAnimations()
                .filter(
                    (animation) =>
                        animation.effect?.getComputedTiming().iterations !==
                        Infinity
                )
                .map((animation) => animation.finished.catch(() => undefined))
        )
    );
}

interface Surface {
    name: string;
    scope: Locator;
    /**
     * Text measured against the rendered pixels under it, so gradient cards,
     * tinted chips and filled buttons all count.
     */
    texts: Locator[];
}

/**
 * Picks an explicit app theme in Settings and saves it. A fresh profile
 * follows the System theme, whose OS listener would rewrite the theme class
 * as soon as the OS scheme changes.
 */
async function chooseAppTheme(page: Page, theme: Theme): Promise<void> {
    await openSettings(page);
    await page
        .getByTestId(theme === 'dark' ? 'DARK_THEME' : 'LIGHT_THEME')
        .click();
    await saveSettings(page);
    await expect(page.locator('body')).toHaveClass(
        theme === 'dark' ? /dark-theme/ : /^(?!.*dark-theme)/
    );
    // The "saved" snackbar would cover the screenshots.
    await expect(page.locator('mat-snack-bar-container')).toBeHidden({
        timeout: 15_000,
    });
}

/**
 * The surface takes its colours from the app theme alone: flipping the OS
 * colour scheme changes nothing, and text stays legible where the app and
 * the OS disagree. Returns the colours for the cross-theme comparison.
 */
async function expectFollowsAppTheme(
    page: Page,
    testInfo: TestInfo,
    theme: Theme,
    surface: Surface
): Promise<Record<string, string>> {
    const osScheme: Theme = theme === 'dark' ? 'light' : 'dark';
    await page.emulateMedia({ colorScheme: theme });
    const underMatchingOs = await paintedColors(surface.scope);
    await page.emulateMedia({ colorScheme: osScheme });
    expect(
        await paintedColors(surface.scope),
        `${surface.name}: app ${theme} theme on a ${osScheme} OS`
    ).toEqual(underMatchingOs);

    await settleAnimations(page);
    const shot = testInfo.outputPath(
        `${surface.name}-app-${theme}-os-${osScheme}.png`
    );
    await page.screenshot({ path: shot });
    await testInfo.attach(`${surface.name} app ${theme} on ${osScheme} OS`, {
        path: shot,
        contentType: 'image/png',
    });
    for (const [index, text] of surface.texts.entries()) {
        expect(
            await measureBackdropTextContrast(page, text),
            `${surface.name}: text ${index} in the ${theme} theme`
        ).toBeGreaterThanOrEqual(4.5);
    }
    return underMatchingOs;
}

/** Starts (or, with `drop`, finishes) a file drag over the workspace. */
async function dragFileOverWorkspace(
    page: Page,
    fileName: string,
    drop = false
): Promise<void> {
    await page.evaluate(
        ({ name, dropFile }) => {
            const target = document.querySelector('.workspace-shell');
            if (!target) throw new Error('Workspace drop target not found.');
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(new File(['#EXTM3U'], name));
            const types = dropFile
                ? ['dragenter', 'dragover', 'drop']
                : ['dragenter', 'dragover'];
            for (const type of types) {
                target.dispatchEvent(
                    new DragEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        dataTransfer,
                    })
                );
            }
        },
        { name: fileName, dropFile: drop }
    );
}

test.describe('App theme over the OS colour scheme', () => {
    test('@theme @electron welcome screens and the drop overlay follow the app theme, not the OS', async ({
        dataDir,
    }, testInfo) => {
        test.setTimeout(150_000);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;
        const colors: Record<string, Partial<Record<Theme, unknown>>> = {};
        const record = (name: string, theme: Theme, value: unknown) => {
            colors[name] = { ...colors[name], [theme]: value };
        };
        try {
            for (const theme of THEMES) {
                await page.emulateMedia({ colorScheme: theme });
                await chooseAppTheme(page, theme);

                await goToDashboard(page);
                const dashboard = page.locator(
                    'app-empty-state .welcome-dashboard'
                );
                await expect(dashboard).toBeVisible();
                record(
                    'welcome-dashboard',
                    theme,
                    await expectFollowsAppTheme(page, testInfo, theme, {
                        name: 'welcome-dashboard',
                        scope: dashboard,
                        texts: [
                            dashboard.locator('.welcome-dashboard__tagline'),
                            dashboard.locator(
                                '.welcome-dashboard__description'
                            ),
                            dashboard.locator('.feature-card__title').first(),
                            dashboard.locator('.feature-card__desc').first(),
                            dashboard.locator(
                                '.welcome-dashboard__cta .mdc-button__label'
                            ),
                        ],
                    })
                );

                await openSources(page);
                const sources = page.locator(
                    'app-empty-state .welcome-sources'
                );
                await expect(sources).toBeVisible();
                record(
                    'welcome-sources',
                    theme,
                    await expectFollowsAppTheme(page, testInfo, theme, {
                        name: 'welcome-sources',
                        scope: sources,
                        texts: [
                            sources.locator('.welcome-sources__body'),
                            sources.locator('.source-card__name').first(),
                            sources.locator('.source-card__needs').first(),
                            sources.locator('.source-card__chip').first(),
                            sources
                                .locator('.source-card__cta .mdc-button__label')
                                .first(),
                        ],
                    })
                );

                const overlay = page.locator('app-playlist-drop-overlay');
                const card = overlay.locator('.drop-overlay__card');
                await dragFileOverWorkspace(page, 'channels.m3u');
                await expect(card).toBeVisible();
                record(
                    'drop-overlay',
                    theme,
                    await expectFollowsAppTheme(page, testInfo, theme, {
                        name: 'drop-overlay',
                        scope: overlay,
                        texts: [
                            card.locator('.drop-overlay__title'),
                            card.locator('.drop-overlay__body'),
                        ],
                    })
                );
                await page.keyboard.press('Escape');
                await expect(card).toBeHidden();

                // The rejection dismisses itself after 1.8s. Both reads must
                // see it, so a slow runner that loses it between them drops
                // again; a colour that follows the OS fails every attempt.
                await expect(async () => {
                    await page.emulateMedia({ colorScheme: theme });
                    await dragFileOverWorkspace(page, 'notes.txt', true);
                    await expect(card).toHaveClass(/is-rejected/, {
                        timeout: 1_000,
                    });
                    const rejected = await paintedColors(overlay);
                    await page.emulateMedia({
                        colorScheme: theme === 'dark' ? 'light' : 'dark',
                    });
                    const underOtherOs = await paintedColors(overlay);
                    expect(
                        await card.getAttribute('class'),
                        'rejection still shown after both reads'
                    ).toMatch(/is-rejected/);
                    expect(
                        underOtherOs,
                        `rejected drop: app ${theme} theme`
                    ).toEqual(rejected);
                    record('rejected drop', theme, rejected);
                }).toPass({ timeout: 20_000 });
                await page.keyboard.press('Escape');
                await expect(card).toBeHidden();
            }
            for (const [name, byTheme] of Object.entries(colors)) {
                expect(byTheme.light, `${name}: light vs dark`).not.toEqual(
                    byTheme.dark
                );
            }
        } finally {
            await page.emulateMedia({ colorScheme: null });
            await closeElectronApp(app);
        }
    });
});
