import { join } from 'path';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    LaunchedElectronApp,
    openSources,
    restartElectronApp,
    test,
    workspaceRoot,
} from './electron-test-fixtures';

/**
 * Chromium's zoom factor as the renderer actually renders it: the window's
 * content width in device-independent pixels over the CSS pixels the page
 * sees. Independent of `getZoomLevel()`, which under file:// reports the
 * per-URL entry and can disagree with what is on screen.
 */
async function renderedZoomFactor(app: LaunchedElectronApp): Promise<number> {
    const contentWidth = await app.electronApp.evaluate(({ BrowserWindow }) => {
        const [win] = BrowserWindow.getAllWindows();
        return win.getContentSize()[0];
    });
    const innerWidth = await app.mainWindow.evaluate(() => window.innerWidth);
    return contentWidth / innerWidth;
}

/**
 * The app zoom shortcuts as the renderer receives them: Cmd on macOS, Ctrl
 * elsewhere. Dispatched through CDP they reach the renderer's keydown
 * binding directly (`WorkspaceKeyboardShortcutsService`), which steps the
 * frame-bound level through the preload bridge; the macOS application menu
 * is not in this path.
 */
const ZOOM_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

async function pressZoomShortcut(
    app: LaunchedElectronApp,
    key: 'Equal' | 'Minus' | 'Digit0' | 'NumpadAdd' | 'NumpadSubtract',
    times = 1
): Promise<void> {
    for (let index = 0; index < times; index += 1) {
        await app.mainWindow.keyboard.press(`${ZOOM_MODIFIER}+${key}`);
    }
}

/**
 * A cross-document navigation of the renderer (what a reload is for zoom:
 * Chromium drops the temporary level and the new document's preload must
 * restore it). Loads the packaged index the way startup does — a plain
 * `page.reload()` on a routed `file://` URL has no file behind it.
 */
async function reloadRenderer(app: LaunchedElectronApp): Promise<void> {
    await app.electronApp.evaluate(({ BrowserWindow }, indexPath) => {
        const [win] = BrowserWindow.getAllWindows();
        return win.loadFile(indexPath);
    }, join(workspaceRoot, 'dist/apps/web/index.html'));
    await app.mainWindow.waitForSelector('app-root');
}

async function resizeWindowBy(
    app: LaunchedElectronApp,
    delta: number
): Promise<void> {
    await app.electronApp.evaluate(({ BrowserWindow }, step) => {
        const [win] = BrowserWindow.getAllWindows();
        const [width, height] = win.getSize();
        win.setSize(width + step, height + step);
    }, delta);
}

// Zoom level 1 is a 1.2 factor; each shortcut press steps the level by 0.5
// (Electron's zoomIn/zoomOut role step). The packaged renderer runs under
// file:// with path routing, where Chromium keys zoom by full URL: without
// frame-bound (temporary) zoom the level "holds" only until the next resize
// after a section change, and a restart brings back the default (issue #1109).
const ZOOMED_FACTOR = 1.2;
const HALF_STEP_FACTOR = Math.sqrt(ZOOMED_FACTOR);

test('@electron @window keeps the zoom level across sections, resizes and a restart', async ({
    dataDir,
}) => {
    let app = await launchElectronApp(dataDir);

    try {
        expect(await renderedZoomFactor(app)).toBeCloseTo(1, 1);

        // In three times, out once (main keys and numpad): level 1.
        await pressZoomShortcut(app, 'Equal', 2);
        await pressZoomShortcut(app, 'NumpadAdd');
        await expect
            .poll(() => renderedZoomFactor(app))
            .toBeCloseTo(ZOOMED_FACTOR * HALF_STEP_FACTOR, 1);
        await pressZoomShortcut(app, 'Minus');
        await expect
            .poll(() => renderedZoomFactor(app))
            .toBeCloseTo(ZOOMED_FACTOR, 1);

        // Reset returns to level 0, then zoom back in (three in, one out on
        // the numpad) for the persistence checks below.
        await pressZoomShortcut(app, 'Digit0');
        await expect.poll(() => renderedZoomFactor(app)).toBeCloseTo(1, 1);
        await pressZoomShortcut(app, 'Equal', 3);
        await pressZoomShortcut(app, 'NumpadSubtract');
        await expect
            .poll(() => renderedZoomFactor(app))
            .toBeCloseTo(ZOOMED_FACTOR, 1);

        // A route change (new file:// URL) followed by the visual-properties
        // sync a resize forces: per-URL zoom snaps back to 1 here.
        await openSources(app.mainWindow);
        await resizeWindowBy(app, 24);
        await app.mainWindow.waitForTimeout(500);
        expect(await renderedZoomFactor(app)).toBeCloseTo(ZOOMED_FACTOR, 1);

        // A reload rebuilds the document; the level must be saved before it
        // and re-applied by the new document's preload.
        await reloadRenderer(app);
        await expect
            .poll(() => renderedZoomFactor(app))
            .toBeCloseTo(ZOOMED_FACTOR, 1);
    } finally {
        app = await restartElectronApp(app, dataDir);
    }

    try {
        await expect
            .poll(() => renderedZoomFactor(app))
            .toBeCloseTo(ZOOMED_FACTOR, 1);
        expect(
            await app.electronApp.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()[0].webContents.getZoomLevel()
            )
        ).toBe(1);

        await openSources(app.mainWindow);
        await resizeWindowBy(app, -24);
        await app.mainWindow.waitForTimeout(500);
        expect(await renderedZoomFactor(app)).toBeCloseTo(ZOOMED_FACTOR, 1);
    } finally {
        await closeElectronApp(app);
    }
});
