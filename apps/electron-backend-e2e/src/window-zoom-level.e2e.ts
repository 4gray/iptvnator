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

/** What the macOS menu roles (Cmd +/−) do: `webContents.zoomLevel += 1`. */
async function zoomInFromMenu(app: LaunchedElectronApp): Promise<void> {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
        const [win] = BrowserWindow.getAllWindows();
        win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 1);
    });
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

// Zoom level 1 is a 1.2 factor. The packaged renderer runs under file:// with
// path routing, where Chromium keys zoom by full URL: without frame-bound
// (temporary) zoom the level "holds" only until the next resize after a
// section change, and a restart brings back the default (issue #1109).
const ZOOMED_FACTOR = 1.2;

test('@electron @window keeps the zoom level across sections, resizes and a restart', async ({
    dataDir,
}) => {
    let app = await launchElectronApp(dataDir);

    try {
        expect(await renderedZoomFactor(app)).toBeCloseTo(1, 1);

        await zoomInFromMenu(app);
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
