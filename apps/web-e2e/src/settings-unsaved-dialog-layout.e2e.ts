import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';

/**
 * The audit found the unsaved-changes actions wrapping in most locales. These
 * are the long-label locales it measured, plus Arabic for the RTL row.
 */
const LOCALES = ['en', 'de', 'ru', 'fr', 'hu', 'ar'] as const;
type Locale = (typeof LOCALES)[number];

const I18N_DIR = join(__dirname, '../../web/src/assets/i18n');

interface UnsavedDialogLabels {
    CANCEL: string;
    SETTINGS: {
        UNSAVED_DIALOG_DISCARD: string;
        UNSAVED_DIALOG_SAVE: string;
    };
}

/** The shipped labels, in DOM order: dismiss, discard, primary save. */
function expectedLabels(locale: Locale): string[] {
    const labels = JSON.parse(
        readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8')
    ) as UnsavedDialogLabels;
    return [
        labels.CANCEL,
        labels.SETTINGS.UNSAVED_DIALOG_DISCARD,
        labels.SETTINGS.UNSAVED_DIALOG_SAVE,
    ];
}

/** Below the 640px phone breakpoint the row stacks by design. */
const PHONE_VIEWPORT = { width: 360, height: 740 };

/**
 * Layout boxes relative to the actions row (its `position: relative` makes it
 * the buttons' offset parent). Offsets ignore the dialog's scale-in transform,
 * which `getBoundingClientRect` would include mid-animation.
 */
interface ActionBox {
    testId: string | null;
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    /** Label broken over more than one line inside its button. */
    labelLines: number;
    /** Label wider than its button (clipped or spilling out). */
    overflows: boolean;
}

interface ActionRow {
    /** The row's content box, between its paddings. */
    contentLeft: number;
    contentRight: number;
    buttons: ActionBox[];
}

async function openSettings(page: Page) {
    await page.locator('a[href$="/workspace/settings"]').click();
    await page.waitForURL(/\/workspace\/settings\/general$/);
    await expect(page.locator('.settings-container')).toBeVisible();
}

async function useLanguage(page: Page, locale: Locale) {
    if (locale === 'en') {
        return;
    }
    await page.locator('[data-test-id="select-language"]').click();
    await page.locator(`mat-option[data-test-id="${locale}"]`).click();

    const saveButton = page.locator('[data-test-id="save-settings"]');
    await saveButton.click();
    await expect(saveButton).toBeHidden();
}

/**
 * Stages an edit, then leaves the settings area so the guard asks. Waiting for
 * the locale's own labels proves the translation loaded before measuring.
 */
async function openUnsavedDialog(page: Page, locale: Locale): Promise<Locator> {
    await page
        .locator('[data-test-id="select-theme"] [data-test-id="DARK_THEME"]')
        .click();
    await expect(
        page.locator('[data-test-id="settings-unsaved-bar"]')
    ).toBeVisible();

    // The rail's Dashboard link stays visible in the phone top bar.
    await page
        .getByRole('navigation')
        .locator('a[href$="/workspace/dashboard"]')
        .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('mat-dialog-actions button')).toHaveText(
        expectedLabels(locale)
    );
    return dialog;
}

async function measureActions(dialog: Locator): Promise<ActionRow> {
    return dialog.locator('mat-dialog-actions').evaluate((row) => {
        const rowStyle = getComputedStyle(row);
        const buttons = Array.from(row.querySelectorAll('button')).map(
            (button) => {
                const label =
                    button.querySelector('.mdc-button__label') ?? button;
                return {
                    testId: button.getAttribute('data-test-id'),
                    top: button.offsetTop,
                    bottom: button.offsetTop + button.offsetHeight,
                    left: button.offsetLeft,
                    right: button.offsetLeft + button.offsetWidth,
                    width: button.offsetWidth,
                    labelLines: label.getClientRects().length,
                    overflows: button.scrollWidth > button.clientWidth + 1,
                };
            }
        );
        return {
            contentLeft: parseFloat(rowStyle.paddingLeft),
            contentRight:
                (row as HTMLElement).clientWidth -
                parseFloat(rowStyle.paddingRight),
            buttons,
        };
    });
}

function expectReadableLabels(row: ActionRow) {
    expect(row.buttons.map((button) => button.testId)).toEqual([
        'unsaved-dialog-stay',
        'unsaved-dialog-discard',
        'unsaved-dialog-save',
    ]);
    for (const button of row.buttons) {
        expect(button.labelLines, `${button.testId} label wraps`).toBe(1);
        expect(button.overflows, `${button.testId} label is cut`).toBe(false);
        expect(button.left).toBeGreaterThanOrEqual(row.contentLeft - 1);
        expect(button.right).toBeLessThanOrEqual(row.contentRight + 1);
    }
}

test.describe('Settings unsaved-changes dialog layout', () => {
    for (const locale of LOCALES) {
        test(`@settings @web keeps the actions on one row (${locale})`, async ({
            page,
        }) => {
            await page.goto('/');
            await openSettings(page);
            await useLanguage(page, locale);
            const dialog = await openUnsavedDialog(page, locale);

            const row = await measureActions(dialog);
            expectReadableLabels(row);
            const [first] = row.buttons;
            for (const button of row.buttons) {
                expect(
                    Math.abs(button.top - first.top),
                    `${button.testId} left the row`
                ).toBeLessThanOrEqual(1);
            }
        });
    }

    for (const locale of ['de', 'ru'] as const) {
        test(`@settings @web stacks the actions full width on a phone (${locale})`, async ({
            page,
        }) => {
            await page.goto('/');
            await openSettings(page);
            await useLanguage(page, locale);
            await page.setViewportSize(PHONE_VIEWPORT);
            const dialog = await openUnsavedDialog(page, locale);

            const row = await measureActions(dialog);
            expectReadableLabels(row);
            // One full-width action per row, in DOM order: dismiss on top,
            // the primary save at the bottom.
            row.buttons.forEach((button, index) => {
                expect(
                    Math.abs(
                        button.width - (row.contentRight - row.contentLeft)
                    )
                ).toBeLessThanOrEqual(1);
                if (index > 0) {
                    expect(button.top).toBeGreaterThanOrEqual(
                        row.buttons[index - 1].bottom
                    );
                }
            });
        });
    }
});
