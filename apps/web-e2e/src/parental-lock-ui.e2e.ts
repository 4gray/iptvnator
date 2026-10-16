import type { Locator, Page } from '@playwright/test';
import { join } from 'path';
import { expect, test } from './fixtures';
import { pressTab, surfaceContrast } from './e2e-helpers';
import {
    addStalkerPortal,
    addXtreamPortal,
    interceptPwaProviderRequests,
    resetPwaMockServers,
} from './sources-pwa.helpers';

/**
 * Parental lock UI on app tokens (PWA).
 *
 * The lock rows, dialogs and PIN error once used Material system colours the
 * theme never declares, so every one of them resolved to nothing: no focus
 * ring after the outline reset, a dashed border and list border with no
 * colour, a PIN error in body text, and dialogs 440–480px wide on a 375px
 * phone. These tests pin the visible result in both themes:
 *
 *   1. Tabbing to each "N locked" row and each Stalker lock row shows a
 *      2px ring with >= 3:1 contrast against the row and its surface.
 *   2. The rail rows' dashed border and the lock list's border are painted.
 *   3. The PIN error is a red with >= 4.5:1 contrast on the dialog.
 *   4. The lock dialogs fit a 375px viewport without sideways overflow.
 *   5. In the PWA the Xtream dialog shows lock controls only — hide/show is
 *      Electron-only — and its clear-search button has a name.
 *
 * Tag: @parental — run only this spec with:
 *   pnpm nx run web-e2e:e2e-ci--src/parental-lock-ui.e2e.ts
 */

const M3U_FIXTURE = join(__dirname, 'fixtures/test.m3u');
const PIN = '2468';
const PHONE = { width: 375, height: 812 };
const THEMES = ['light', 'dark'] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
    await page.evaluate(
        (dark) => document.body.classList.toggle('dark-theme', dark),
        theme === 'dark'
    );
}

async function enableParentalLock(page: Page): Promise<void> {
    await page.locator('a[href$="/workspace/settings"]').click();
    await page.waitForURL(/\/workspace\/settings\/general$/);
    await page.locator('[data-test-id="settings-section-parental"]').click();
    await page.waitForURL(/\/workspace\/settings\/parental$/);

    const toggle = page.locator(
        '[data-test-id="parental-lock-enabled"] button[role="switch"]'
    );
    await toggle.click();
    await page.locator('[data-test-id="parental-lock-pin"]').fill(PIN);
    await page.locator('[data-test-id="parental-lock-pin-confirm"]').fill(PIN);
    await page.locator('[data-test-id="parental-lock-pin-submit"]').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
}

/** Answers the unlock prompt that a PIN-gated action opens. */
async function enterPin(page: Page, pin = PIN): Promise<void> {
    const input = page.locator('[data-test-id="parental-lock-pin"]');
    await expect(input).toBeVisible();
    await input.fill(pin);
    await page.locator('[data-test-id="parental-lock-pin-submit"]').click();
}

/**
 * The dialog opened for `component`, once it holds focus: MatDialog moves
 * focus to its first tabbable element only after the open animation, which
 * would otherwise pull focus away from a row the test has just tabbed to.
 */
async function openedDialog(page: Page, component: string): Promise<Locator> {
    const dialog = page.locator('mat-dialog-container', {
        has: page.locator(component),
    });
    await expect
        .poll(() =>
            dialog.evaluate((el) => el.contains(document.activeElement))
        )
        .toBe(true);
    return dialog;
}

/**
 * WCAG contrast of one colour property against what is painted behind the
 * element: white, each ancestor's background and, with `ownFill`, the
 * element's own background (the approach of `surfaceContrast`).
 */
async function contrastBehind(
    locator: Locator,
    property: 'color' | 'outlineColor',
    ownFill: boolean
): Promise<number> {
    return locator.evaluate(
        (element, [property, ownFill]) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Canvas is required');
            const paint = (color: string) => {
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
            };
            const luminance = () =>
                Array.from(context.getImageData(0, 0, 1, 1).data)
                    .slice(0, 3)
                    .map((value) => {
                        const channel = value / 255;
                        return channel <= 0.04045
                            ? channel / 12.92
                            : ((channel + 0.055) / 1.055) ** 2.4;
                    })
                    .reduce(
                        (sum, channel, index) =>
                            sum + channel * [0.2126, 0.7152, 0.0722][index],
                        0
                    );
            const layers: Element[] = ownFill ? [element] : [];
            for (let e = element.parentElement; e; e = e.parentElement) {
                layers.unshift(e);
            }
            paint('white');
            layers.forEach((layer) =>
                paint(getComputedStyle(layer).backgroundColor)
            );
            const behind = luminance();
            paint(getComputedStyle(element)[property]);
            const front = luminance();
            return (
                (Math.max(front, behind) + 0.05) /
                (Math.min(front, behind) + 0.05)
            );
        },
        [property, ownFill] as const
    );
}

/** Focus `from` and Tab (as that browser's user does) until `target` has focus. */
async function tabTo(
    page: Page,
    browserName: string,
    from: Locator,
    target: Locator,
    maxTabs = 1
): Promise<void> {
    await from.focus();
    for (let i = 0; i < maxTabs; i++) {
        await pressTab(page, browserName);
        if (await target.evaluate((el) => el === document.activeElement)) {
            break;
        }
    }
    await expect(target).toBeFocused();
}

/**
 * The ring sits inside the row (offset -2px), so it must stand out from the
 * row's own fill and from the surface around the row.
 */
async function expectFocusRing(row: Locator): Promise<void> {
    await expect(row).toBeFocused();
    await expect(row).toHaveCSS('outline-style', 'solid');
    await expect(row).toHaveCSS('outline-width', '2px');
    const inside = await contrastBehind(row, 'outlineColor', true);
    const outside = await contrastBehind(row, 'outlineColor', false);
    expect(Math.min(inside, outside)).toBeGreaterThanOrEqual(3);
}

/** Colour and fill of a lock toggle, to tell locked from unlocked. */
async function toggleLook(toggle: Locator): Promise<string> {
    return toggle.evaluate((el) => {
        const style = getComputedStyle(el);
        return `${style.color} ${style.backgroundColor}`;
    });
}

async function expectPaintedBorder(
    locator: Locator,
    style: 'dashed' | 'solid'
): Promise<void> {
    await expect(locator).toHaveCSS('border-top-style', style);
    const { border } = await surfaceContrast(locator);
    // 1 means the border colour is transparent against its own fill.
    expect(border).toBeGreaterThan(1.15);
}

async function expectDialogFitsPhone(
    page: Page,
    dialog: Locator
): Promise<void> {
    await page.setViewportSize(PHONE);
    await expect
        .poll(async () => {
            const box = await dialog.boundingBox();
            return box ? box.x >= 0 && box.x + box.width <= PHONE.width : false;
        })
        .toBe(true);
    // A min-width on the content overflows the capped panel without
    // widening the panel or the document, so measure the blocks inside.
    const overflow = await dialog.evaluate((panel) => {
        const edge = panel.getBoundingClientRect().right;
        const blocks = panel.querySelectorAll(
            'mat-dialog-content, mat-dialog-actions, .header-actions, ' +
                '.search-inline, .categories-list'
        );
        return Math.max(
            ...Array.from(
                blocks,
                (block) => block.getBoundingClientRect().right - edge
            )
        );
    });
    expect(overflow).toBeLessThanOrEqual(0.5);
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(PHONE.width);
}

test.describe('Parental lock UI', () => {
    test.beforeEach(async ({ page, request }) => {
        await resetPwaMockServers(request);
        await interceptPwaProviderRequests(page);
        await page.goto('/');
    });

    test('@parental @xtream PWA dialog, locked-categories row and PIN error', async ({
        page,
        browserName,
    }) => {
        test.slow();
        await addXtreamPortal(page, 'Lock UI Portal');
        const portalUrl = page.url();
        await enableParentalLock(page);
        // A reload starts locked: the unlock lives in memory only.
        await page.goto(portalUrl);

        const manage = page.locator(
            '[data-test-id="context-manage-categories"]'
        );
        await expect(manage).toBeEnabled({ timeout: 15_000 });
        await manage.click();
        await enterPin(page);

        const dialog = await openedDialog(
            page,
            'app-category-management-dialog'
        );
        const toggles = dialog.locator('[data-test-id^="category-lock-"]');
        await expect(toggles.first()).toBeVisible();

        // PWA: locks only, no hide/show selection controls.
        await expect(
            dialog.locator('[data-test-id="category-locked-count"]')
        ).toBeVisible();
        await expect(dialog.locator('.bulk-actions')).toHaveCount(0);
        await expect(dialog.locator('mat-checkbox')).toHaveCount(0);

        await dialog.locator('.search-inline input').fill('a');
        await dialog.getByRole('button', { name: 'Clear search' }).click();
        await expect(dialog.locator('.search-inline input')).toHaveValue('');

        // Locked reads as a state, not only as another glyph.
        await toggles.first().click();
        await expect(toggles.first()).toHaveAttribute('aria-pressed', 'true');
        expect(await toggleLook(toggles.first())).not.toBe(
            await toggleLook(toggles.nth(1))
        );

        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden();
        await page.locator('[data-test-id="header-parental-lock"]').click();

        const lockedRow = page.locator(
            '[data-test-id="context-locked-categories"]'
        );
        await expect(lockedRow).toBeVisible();
        await tabTo(
            page,
            browserName,
            page.locator('.context-panel .category-item').last(),
            lockedRow
        );
        for (const theme of THEMES) {
            await setTheme(page, theme);
            await expectFocusRing(lockedRow);
            await expectPaintedBorder(lockedRow, 'dashed');
        }

        // A wrong PIN reads as an error in both themes.
        await lockedRow.click();
        await enterPin(page, '0000');
        const error = page.locator('[data-test-id="parental-lock-pin-error"]');
        await expect(error).toBeVisible();
        for (const theme of THEMES) {
            await setTheme(page, theme);
            const [r, g, b] = await error.evaluate((el) =>
                (getComputedStyle(el).color.match(/\d+/g) ?? []).map(Number)
            );
            expect(r - Math.max(g, b)).toBeGreaterThan(50);
            expect(await contrastBehind(error, 'color', true)).toBeGreaterThan(
                4.5
            );
        }
        await enterPin(page);
        await expect(lockedRow).toBeHidden();

        await manage.click();
        await expect(toggles.first()).toBeVisible();
        await expectDialogFitsPhone(page, dialog);
    });

    test('@parental @stalker lock dialog rows, list border and phone width', async ({
        page,
        browserName,
    }) => {
        test.slow();
        await addStalkerPortal(page, 'Lock UI Stalker');
        const portalUrl = page.url();
        await enableParentalLock(page);
        await page.goto(portalUrl);

        const manage = page.locator(
            '[data-test-id="context-manage-categories"]'
        );
        await expect(manage).toBeEnabled({ timeout: 15_000 });
        await manage.click();
        await enterPin(page);

        const dialog = await openedDialog(
            page,
            'app-stalker-category-lock-dialog'
        );
        const rows = dialog.locator('.category-item');
        await expect(rows.first()).toBeVisible();

        const search = dialog.locator('.search-inline input');
        await tabTo(page, browserName, search, rows.first());
        for (const theme of THEMES) {
            await setTheme(page, theme);
            await expectFocusRing(rows.first());
            await expectPaintedBorder(
                dialog.locator('.categories-list'),
                'solid'
            );
        }
        // The next row takes the ring over when Tab moves on.
        await pressTab(page, browserName);
        await expectFocusRing(rows.nth(1));

        await search.fill('a');
        await dialog.getByRole('button', { name: 'Clear search' }).click();
        await expect(search).toHaveValue('');

        await expectDialogFitsPhone(page, dialog);
    });

    test('@parental @m3u locked-groups row', async ({ page, browserName }) => {
        test.slow();
        // The fixture's placeholder media hosts stay offline.
        await page.route(
            /^https?:\/\/(?:channel\.icons\.url|example\.channels|xml-url)\//,
            (route) => route.abort()
        );
        await page.getByRole('button', { name: 'Add playlist' }).click();
        const addDialog = page.locator('mat-dialog-container');
        await addDialog.getByRole('radio', { name: /M3U file/i }).click();
        await page.setInputFiles('input[type="file"]', M3U_FIXTURE);
        await Promise.all([
            page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
            addDialog
                .getByRole('button', { name: 'Add playlist', exact: true })
                .click(),
        ]);
        const groupsUrl = page.url().replace(/\/all$/, '/groups');
        await enableParentalLock(page);
        await page.goto(groupsUrl);

        const manage = page.locator('.groups-nav-action--manage');
        await expect(manage).toBeVisible({ timeout: 15_000 });
        await manage.click();
        await enterPin(page);

        const dialog = await openedDialog(page, 'app-group-management-dialog');
        const toggle = dialog.locator('[data-test-id="group-lock-News"]');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(await toggleLook(toggle)).not.toBe(
            await toggleLook(
                dialog.locator('[data-test-id="group-lock-Sport"]')
            )
        );
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden();
        await page.locator('[data-test-id="header-parental-lock"]').click();

        const lockedRow = page.locator('[data-test-id="groups-locked-row"]');
        await expect(lockedRow).toBeVisible();
        await tabTo(
            page,
            browserName,
            page.locator('.groups-nav-list .nav-item').last(),
            lockedRow
        );
        for (const theme of THEMES) {
            await setTheme(page, theme);
            await expectFocusRing(lockedRow);
            await expectPaintedBorder(lockedRow, 'dashed');
        }
    });
});
