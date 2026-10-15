import type { CDPSession, Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickFirstGridListCard,
    closeElectronApp,
    expect,
    launchElectronApp,
    resetMockServers,
    test,
    waitForXtreamWorkspaceReady,
    type LaunchedElectronApp,
} from './electron-test-fixtures';

// ---------------------------------------------------------------------------
// Platform Back gestures run the workspace header's Back: the mouse Back
// button, Alt+← (Cmd+[ on macOS), and the window's `app-command`
// (`browser-backward`, Windows/Linux) and trackpad `swipe` (macOS), which the
// main process forwards to the renderer. Each goes back exactly one step. A
// mouse Back press that reaches the app both as a renderer `mouseup` and as
// an `app-command` (Windows and Linux) still goes back once. There is no
// Forward. Gestures are ignored while typing (the chord) and while a dialog
// is open.
//
// The window events are emitted on the main process's BrowserWindow, so the
// specs run on every platform even though Electron raises each event only
// on its own.
// ---------------------------------------------------------------------------

const detailUrlPattern = /\/workspace\/xtreams\/[^/]+\/series\/[^/]+\/[^/]+$/;
const backChord =
    process.platform === 'darwin' ? 'Meta+BracketLeft' : 'Alt+ArrowLeft';

type WindowGesture =
    | { event: 'app-command'; value: 'browser-backward' | 'browser-forward' }
    | { event: 'swipe'; value: 'left' | 'right' };

async function emitWindowGesture(
    app: LaunchedElectronApp,
    gesture: WindowGesture
): Promise<void> {
    await app.electronApp.evaluate(({ BrowserWindow }, { event, value }) => {
        const [win] = BrowserWindow.getAllWindows();
        win.emit(event, {}, value);
    }, gesture);
}

/** Half of a mouse Back press through Chromium's input pipeline. */
async function mouseBack(
    cdp: CDPSession,
    page: Page,
    type: 'mousePressed' | 'mouseReleased'
): Promise<void> {
    const box = await page.locator('main').first().boundingBox();
    await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: Math.round((box?.x ?? 0) + (box?.width ?? 400) / 2),
        y: Math.round((box?.y ?? 0) + (box?.height ?? 400) / 2),
        button: 'back',
        buttons: type === 'mousePressed' ? 8 : 0,
        clickCount: 1,
    });
}

async function pressMouseBack(cdp: CDPSession, page: Page): Promise<void> {
    await mouseBack(cdp, page, 'mousePressed');
    await mouseBack(cdp, page, 'mouseReleased');
}

async function openFirstSeries(page: Page): Promise<string> {
    await clickFirstGridListCard(page);
    await page.waitForURL(detailUrlPattern);
    await expect(page.locator('app-portal-detail-shell')).toBeVisible({
        timeout: 20_000,
    });
    return page.url();
}

/** The history index Back gestures must land on, and nothing below it. */
function historyIndex(page: Page): Promise<number> {
    return page.evaluate(() => window.navigation?.currentEntry?.index ?? -1);
}

/** Time for a late second step (a duplicated press) to surface. */
function settle(page: Page): Promise<unknown> {
    return page.evaluate(
        () => new Promise((resolve) => setTimeout(resolve, 400))
    );
}

/**
 * Waits for a gesture to return to the list, then for any late second step
 * to surface before checking the history index.
 */
async function expectBackToList(
    page: Page,
    listUrl: string,
    listIndex: number
): Promise<void> {
    await expect(page).toHaveURL(listUrl);
    await expect(page.locator('app-portal-detail-shell')).toHaveCount(0);
    await settle(page);
    await expect(page).toHaveURL(listUrl);
    expect(await historyIndex(page)).toBe(listIndex);
}

/** The Xtream series list, reached by navigation from the start page. */
async function openSeriesList(
    page: Page
): Promise<{ listUrl: string; listIndex: number }> {
    await addXtreamPortal(page);
    await waitForXtreamWorkspaceReady(page);
    await page.getByRole('link', { name: 'Series', exact: true }).click();
    await page.waitForURL(/\/series$/);
    await expect(
        page.locator('.category-content-layout mat-card').first()
    ).toBeVisible({ timeout: 20_000 });
    return { listUrl: page.url(), listIndex: await historyIndex(page) };
}

test.describe('Platform Back gestures', () => {
    test('@xtream @electron mouse Back, the Back chord and the window gestures each go back one step', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            const cdp = await app.electronApp.context().newCDPSession(page);
            const { listUrl, listIndex } = await openSeriesList(page);

            await openFirstSeries(page);
            await pressMouseBack(cdp, page);
            await expectBackToList(page, listUrl, listIndex);

            await openFirstSeries(page);
            await page.keyboard.press(backChord);
            await expectBackToList(page, listUrl, listIndex);

            await openFirstSeries(page);
            await emitWindowGesture(app, {
                event: 'app-command',
                value: 'browser-backward',
            });
            await expectBackToList(page, listUrl, listIndex);

            await openFirstSeries(page);
            await emitWindowGesture(app, { event: 'swipe', value: 'left' });
            await expectBackToList(page, listUrl, listIndex);

            // No Forward: Stalker inline details are not history entries.
            await emitWindowGesture(app, {
                event: 'app-command',
                value: 'browser-forward',
            });
            await emitWindowGesture(app, { event: 'swipe', value: 'right' });
            await expectBackToList(page, listUrl, listIndex);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@xtream @electron a mouse Back press that also arrives as an app command goes back once', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            const cdp = await app.electronApp.context().newCDPSession(page);
            const { listUrl, listIndex } = await openSeriesList(page);

            await openFirstSeries(page);
            await Promise.all([
                pressMouseBack(cdp, page),
                emitWindowGesture(app, {
                    event: 'app-command',
                    value: 'browser-backward',
                }),
            ]);
            await expectBackToList(page, listUrl, listIndex);

            // The pairing is per press: the next one goes back again.
            await openFirstSeries(page);
            await emitWindowGesture(app, {
                event: 'app-command',
                value: 'browser-backward',
            });
            await pressMouseBack(cdp, page);
            await expectBackToList(page, listUrl, listIndex);

            // Linux sends the command on press: a long hold is one press.
            await openFirstSeries(page);
            await mouseBack(cdp, page, 'mousePressed');
            await emitWindowGesture(app, {
                event: 'app-command',
                value: 'browser-backward',
            });
            await expect(page).toHaveURL(listUrl);
            await settle(page);
            await settle(page);
            await mouseBack(cdp, page, 'mouseReleased');
            await expectBackToList(page, listUrl, listIndex);
        } finally {
            await closeElectronApp(app);
        }
    });

    test('@xtream @electron gestures wait while typing or while a dialog is open', async ({
        dataDir,
        request,
    }) => {
        await resetMockServers(request, ['xtream']);
        const app = await launchElectronApp(dataDir);

        try {
            const page = app.mainWindow;
            const cdp = await app.electronApp.context().newCDPSession(page);
            const { listUrl, listIndex } = await openSeriesList(page);

            // Alt/Option arrows edit text in a field. The list has the
            // history fallback, so the chord would otherwise go back.
            const search = page.locator(
                'app-workspace-shell-header input[type="search"]'
            );
            await expect(search).toBeEnabled();
            await search.focus();
            await page.keyboard.press(backChord);
            await settle(page);
            await expect(page).toHaveURL(listUrl);
            await search.blur();

            const detailUrl = await openFirstSeries(page);

            // One at a time: a gesture that slipped through would navigate,
            // and the dialog would close with the navigation.
            await page.locator('app-portal-detail-shell').focus();
            await page.keyboard.press('?');
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible();
            for (const gesture of [
                () => page.keyboard.press(backChord),
                // Electron's Chromium would step back on its own.
                () => pressMouseBack(cdp, page),
                () => emitWindowGesture(app, { event: 'swipe', value: 'left' }),
            ]) {
                await gesture();
                await settle(page);
                await expect(page).toHaveURL(detailUrl);
                await expect(dialog).toBeVisible();
            }

            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await page.keyboard.press(backChord);
            await expectBackToList(page, listUrl, listIndex);
        } finally {
            await closeElectronApp(app);
        }
    });
});
