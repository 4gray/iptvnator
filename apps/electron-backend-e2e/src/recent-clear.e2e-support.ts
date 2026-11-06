import type { Locator, Page } from '@playwright/test';
import { expect } from './electron-test-fixtures';
import { navigateWithinWorkspace } from './workspace-route.e2e-support';

/**
 * `/workspace/<provider>/<id>/recent` of the source the page is in: the
 * source's own recently viewed page, which the dashboard's recently viewed
 * rails open.
 */
export function sourceRecentPath(page: Page): string {
    const source = /\/workspace\/(?:xtreams|stalker|playlists)\/[^/]+/.exec(
        new URL(page.url()).pathname
    );
    if (!source) {
        throw new Error(`The page is not inside a source: ${page.url()}`);
    }
    return `${source[0]}/recent`;
}

export async function openSourceRecent(
    page: Page,
    recentPath: string
): Promise<void> {
    await navigateWithinWorkspace(page, recentPath);
}

/** Every control on the page that clears recently viewed items. */
function clearRecentControls(page: Page): Locator {
    return page.getByRole('button', { name: /^Clear recently viewed\b/ });
}

/**
 * Presses the page's only "Clear recently viewed <type>" control and returns
 * the confirmation it opens: one control per page, one question per press.
 */
async function askToClearRecent(
    page: Page,
    typeLabel: string
): Promise<Locator> {
    await expect(clearRecentControls(page)).toHaveCount(1);
    await page
        .getByRole('button', {
            name: `Clear recently viewed ${typeLabel}`,
            exact: true,
        })
        .click();

    const dialogs = page.locator('mat-dialog-container');
    await expect(dialogs).toHaveCount(1);
    await expect(
        dialogs.getByRole('heading', {
            name: `Clear recently viewed ${typeLabel}?`,
        })
    ).toBeVisible();
    return dialogs;
}

export async function cancelClearRecentItems(
    page: Page,
    typeLabel: string
): Promise<void> {
    const dialog = await askToClearRecent(page, typeLabel);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('mat-dialog-container')).toHaveCount(0);
}

export async function clearRecentItems(
    page: Page,
    typeLabel: string
): Promise<void> {
    const dialog = await askToClearRecent(page, typeLabel);
    await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('mat-dialog-container')).toHaveCount(0);
}
