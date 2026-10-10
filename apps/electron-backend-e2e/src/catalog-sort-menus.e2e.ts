import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    launchElectronApp,
    openSettings,
    openSources,
    openWorkspaceSection,
    resetMockServers,
    saveSettings,
    test,
    waitForXtreamWorkspaceReady,
} from './electron-test-fixtures';
import { fetchXtreamLiveFixture } from './portal-mock-fixtures';
import { applyTheme, expectTextContrast } from './theme-contrast';

// ---------------------------------------------------------------------------
// The catalog header's sort chip shows a short label for the active sort at
// every width ("Newest", not "Sort: Date Added (Latest First)"), so it never
// truncates, also in the long translations; the full text is its name.
//
// Single-choice menus (catalog refine, live channels, categories, sources)
// are radio groups: every row reserves the same leading check slot, so the
// labels share one left edge, and `aria-checked` marks the active choice.
// ---------------------------------------------------------------------------

const locales = ['en', 'de', 'ru', 'hu'] as const;
type Locale = (typeof locales)[number];

/**
 * Per locale, in menu order: the visible chip text of the six content sorts
 * and the full text screen readers get instead.
 */
function sortChipLabels(
    locale: Locale
): { visible: string; screenReader: string }[] {
    const workspace = (
        JSON.parse(
            readFileSync(
                join(__dirname, `../../web/src/assets/i18n/${locale}.json`),
                'utf8'
            )
        ) as {
            WORKSPACE: {
                SORT_LABEL: string;
                SORT_DATE_DESC: string;
                SORT_DATE_ASC: string;
                SORT_NAME_ASC: string;
                SORT_NAME_DESC: string;
                SORT_TOP_RATED: string;
                SORT_LOWEST_RATED: string;
                SORT_CHIP: {
                    NEWEST: string;
                    OLDEST: string;
                    TOP_RATED: string;
                    LOWEST_RATED: string;
                };
            };
        }
    ).WORKSPACE;
    return (
        [
            [workspace.SORT_CHIP.NEWEST, workspace.SORT_DATE_DESC],
            [workspace.SORT_CHIP.OLDEST, workspace.SORT_DATE_ASC],
            [workspace.SORT_NAME_ASC, workspace.SORT_NAME_ASC],
            [workspace.SORT_NAME_DESC, workspace.SORT_NAME_DESC],
            [workspace.SORT_CHIP.TOP_RATED, workspace.SORT_TOP_RATED],
            [workspace.SORT_CHIP.LOWEST_RATED, workspace.SORT_LOWEST_RATED],
        ] as const
    ).map(([visible, full]) => ({
        visible,
        screenReader: `${workspace.SORT_LABEL}${full}`,
    }));
}

function openMenuPanel(page: Page): Locator {
    return page.locator('.cdk-overlay-pane .mat-mdc-menu-panel').last();
}

async function openRefineMenu(page: Page): Promise<Locator> {
    await page.locator('app-category-content-view .refine-action').click();
    const menu = openMenuPanel(page);
    await expect(menu).toBeVisible();
    await settleAnimations(menu);
    return menu;
}

async function settleAnimations(menu: Locator): Promise<void> {
    await menu.evaluate((element) =>
        Promise.all(
            element
                .getAnimations()
                .map((animation) => animation.finished.catch(() => undefined))
        )
    );
}

async function closeMenu(page: Page, menu: Locator): Promise<void> {
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
}

interface RadioRow {
    checked: string | null;
    labelLeft: number;
    checkVisible: boolean;
}

async function radioRows(group: Locator): Promise<RadioRow[]> {
    return group.getByRole('menuitemradio').evaluateAll((rows) =>
        rows.map((row) => {
            const check = row.querySelector('.app-menu-item-radio-check');
            return {
                checked: row.getAttribute('aria-checked'),
                labelLeft: Math.round(
                    row
                        .querySelector('.mat-mdc-menu-item-text')
                        ?.getBoundingClientRect().left ?? Number.NaN
                ),
                checkVisible:
                    check !== null &&
                    getComputedStyle(check).visibility === 'visible',
            };
        })
    );
}

/**
 * One radio group: every label on one left edge, exactly the expected row
 * checked, and the check glyph visible on that row only.
 */
async function expectRadioGroup(
    group: Locator,
    checkedIndex: number,
    label: string
): Promise<void> {
    const rows = await radioRows(group);
    expect(rows.length, label).toBeGreaterThan(1);
    expect(
        [...new Set(rows.map((row) => row.labelLeft))],
        `${label}: label offsets ${JSON.stringify(rows)}`
    ).toHaveLength(1);
    expect(
        rows.map((row) => row.checked),
        label
    ).toEqual(rows.map((_, index) => String(index === checkedIndex)));
    expect(
        rows.map((row) => row.checkVisible),
        label
    ).toEqual(rows.map((_, index) => index === checkedIndex));
}

/** Visible chip labels and whether each one shows its whole text. */
async function chipLabelFits(page: Page) {
    return page
        .locator('app-category-content-view .refinement-chip')
        .evaluateAll((chips) =>
            chips.flatMap((chip) =>
                [
                    chip,
                    ...chip.querySelectorAll<HTMLElement>(
                        '.refinement-chip-label'
                    ),
                ]
                    .filter((element) => element.getClientRects().length > 0)
                    .map((element) => ({
                        text: element.textContent?.trim() ?? '',
                        fits: element.scrollWidth <= element.clientWidth,
                    }))
            )
        );
}

async function switchLanguage(page: Page, locale: Locale): Promise<void> {
    const catalogUrl = page.url();
    await openSettings(page);
    await page.getByTestId('select-language').click();
    await page.getByTestId(locale).click();
    await saveSettings(page);
    await page.goBack();
    await page.waitForURL(catalogUrl);
    await expect(
        page.locator('app-category-content-view mat-card').first()
    ).toBeVisible({ timeout: 20_000 });
}

test.describe('Electron catalog sort menus', () => {
    test('keeps the refine chips whole at 1280px in en, de, ru and hu, with the refine menu as aligned radio groups', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;

        try {
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await page.setViewportSize({ width: 1280, height: 800 });
            await openWorkspaceSection(page, 'Movies');
            await expect(
                page.locator('app-category-content-view mat-card').first()
            ).toBeVisible({ timeout: 20_000 });

            // A rating threshold shows the second chip next to the sort one.
            let menu = await openRefineMenu(page);
            await menu
                .getByRole('group')
                .nth(1)
                .getByRole('menuitemradio')
                .nth(5)
                .click();
            await expect(menu).toBeHidden();

            for (const locale of locales) {
                if (locale !== 'en') await switchLanguage(page, locale);
                const chipLabels = sortChipLabels(locale);

                for (const [index, chipLabel] of chipLabels.entries()) {
                    menu = await openRefineMenu(page);
                    await menu
                        .getByRole('group')
                        .first()
                        .getByRole('menuitemradio')
                        .nth(index)
                        .click();
                    await expect(menu).toBeHidden();

                    const sortChip = page.locator(
                        'app-category-content-view .sort-refinement-chip'
                    );
                    await expect(
                        sortChip.locator('.refinement-chip-label')
                    ).toHaveText(chipLabel.visible);
                    // The accessibility tree holds the full text only; the
                    // short label is aria-hidden.
                    await expect(sortChip).toMatchAriaSnapshot(
                        `- text: ${JSON.stringify(chipLabel.screenReader)}`
                    );
                    const fits = await chipLabelFits(page);
                    expect(
                        fits.filter((chip) => !chip.fits),
                        `${locale}: ${JSON.stringify(fits)}`
                    ).toEqual([]);
                }

                menu = await openRefineMenu(page);
                const groups = menu.getByRole('group');
                await expect(groups).toHaveCount(2);
                await expectRadioGroup(groups.nth(0), 5, `${locale} sort`);
                await expectRadioGroup(groups.nth(1), 5, `${locale} rating`);
                const lefts = (await radioRows(menu)).map(
                    (row) => row.labelLeft
                );
                expect(
                    [...new Set(lefts)],
                    `${locale}: both groups`
                ).toHaveLength(1);
                await closeMenu(page, menu);
            }
        } finally {
            await closeElectronApp(app);
        }
    });

    test('shows aligned radio rows with a legible check in the live, category and source sort menus, in light and dark themes', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const liveFixture = await fetchXtreamLiveFixture(request, {
            username: defaultXtreamUsername,
            password: defaultXtreamPassword,
        });
        const app = await launchElectronApp(dataDir);
        const page = app.mainWindow;

        try {
            await addXtreamPortal(page);
            await waitForXtreamWorkspaceReady(page);
            await openWorkspaceSection(page, 'Live TV');
            await clickCategoryByNameExact(page, liveFixture.categoryName);

            for (const theme of ['light', 'dark'] as const) {
                await applyTheme(page, theme);

                await page
                    .getByRole('button', { name: 'Sort channels', exact: true })
                    .click();
                let menu = openMenuPanel(page);
                await expect(menu).toBeVisible();
                await settleAnimations(menu);
                await expectRadioGroup(menu, 0, `${theme} live channels`);
                await expectCheckedRowLegible(menu);
                await menu
                    .getByRole('menuitemradio', { name: 'Name Z-A' })
                    .click();
                await expect(menu).toBeHidden();
                await page
                    .getByRole('button', { name: 'Sort channels', exact: true })
                    .click();
                menu = openMenuPanel(page);
                await settleAnimations(menu);
                await expectRadioGroup(menu, 2, `${theme} live channels`);
                await menu
                    .getByRole('menuitemradio', { name: 'Server order' })
                    .click();
                await expect(menu).toBeHidden();

                await page
                    .getByRole('button', {
                        name: 'Sort categories',
                        exact: true,
                    })
                    .click();
                menu = openMenuPanel(page);
                await expect(menu).toBeVisible();
                await settleAnimations(menu);
                await expectRadioGroup(menu, 0, `${theme} categories`);
                await expectCheckedRowLegible(menu);
                await closeMenu(page, menu);
            }

            await openSources(page);
            for (const theme of ['light', 'dark'] as const) {
                await applyTheme(page, theme);
                await page
                    .locator('app-workspace-sources .sort-trigger')
                    .click();
                const menu = openMenuPanel(page);
                await expect(menu).toBeVisible();
                await settleAnimations(menu);
                await expectRadioGroup(menu, 0, `${theme} sources`);
                await expectCheckedRowLegible(menu);
                await closeMenu(page, menu);
            }
        } finally {
            await closeElectronApp(app);
        }
    });
});

/** The check glyph is a graphic (3:1); the label is text (4.5:1). */
async function expectCheckedRowLegible(menu: Locator): Promise<void> {
    const row = menu.locator('[role="menuitemradio"][aria-checked="true"]');
    await expectTextContrast(row.locator('.app-menu-item-radio-check'), 3);
    await expectTextContrast(row.locator('.mat-mdc-menu-item-text'), 4.5);
}
