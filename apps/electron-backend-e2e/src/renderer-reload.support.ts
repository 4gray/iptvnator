import { expect, Page } from '@playwright/test';
import { LaunchedElectronApp } from './electron-test-fixtures';

/**
 * Helpers for E2E that reload the packaged renderer on an in-app route.
 *
 * The URL before and after a recovered reload is the same routed `file://`
 * URL, so waiting on the URL alone passes before anything happened. The
 * current document is marked instead, and the wait is for a document
 * WITHOUT the mark that has reached the route.
 */

const DOCUMENT_MARK = 'data-e2e-pre-reload';

async function markCurrentDocument(page: Page): Promise<void> {
    await page.evaluate((attribute) => {
        document.documentElement.setAttribute(attribute, '');
    }, DOCUMENT_MARK);
}

/** What the macOS View › Reload menu role does: `webContents.reload()`. */
export async function reloadFromMainProcess(
    app: LaunchedElectronApp
): Promise<void> {
    await markCurrentDocument(app.mainWindow);
    await app.electronApp.evaluate(({ BrowserWindow }) => {
        const [win] = BrowserWindow.getAllWindows();
        win.webContents.reload();
    });
}

/**
 * What the settings unsaved-changes guard does after a confirmed reload:
 * `window.location.reload()`. The evaluate may lose its execution context
 * to the navigation it starts; that is not a failure.
 */
export async function reloadFromRenderer(
    app: LaunchedElectronApp
): Promise<void> {
    await markCurrentDocument(app.mainWindow);
    await app.mainWindow
        .evaluate(() => {
            window.location.reload();
        })
        .catch(() => undefined);
}

/**
 * Waits until a NEW document is rendered on `pathname` — the app re-booted
 * on the route rather than the old document still being on screen — and
 * checks that the restore parameter was consumed on the way.
 */
export async function expectRendererReloadedOnRoute(
    page: Page,
    pathname: RegExp
): Promise<void> {
    await expect(page.locator(`html[${DOCUMENT_MARK}]`)).toHaveCount(0);
    await expect(page).toHaveURL(pathname);
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    document.querySelector('app-root')?.innerHTML.trim()
                        .length ?? 0
            )
        )
        .toBeGreaterThan(0);
    expect(new URL(page.url()).searchParams.has('restoreRoute')).toBe(false);
}
