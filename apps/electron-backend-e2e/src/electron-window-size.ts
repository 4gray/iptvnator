import type { ElectronApplication, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The width the app opens at on a screen at least this wide. */
export const DEFAULT_E2E_WINDOW_WIDTH = 1280;

/**
 * The startup window mode stored in the profile, or `normal` without one.
 * A spec that saves `maximized` or `fullscreen` asks for that window.
 */
function storedStartupWindowMode(dataDir: string): string {
    try {
        const config = JSON.parse(
            readFileSync(join(dataDir, 'config', 'config.json'), 'utf8')
        ) as Record<string, unknown>;
        const mode = config['STARTUP_WINDOW_MODE'];
        return typeof mode === 'string' ? mode : 'normal';
    } catch {
        return 'normal';
    }
}

/**
 * The app opens at `min(1280, work area)` wide (app.ts). The Windows and
 * macOS CI runners have 1024px screens, which puts every test inside the
 * compact Live TV band (641–1100px, UI-67) where the categories rail folds
 * away. Specs are written against the default desktop width, so a launch
 * narrower than it is widened to it; tests that need a narrow window resize
 * it themselves.
 *
 * Only a stored maximized or fullscreen startup mode keeps its window.
 * `isMaximized()` is not that signal: on a small macOS screen the default
 * window fills the work area, and Electron reports such a zoomed window as
 * maximized.
 */
export async function widenToDefaultDesktopWidth(
    application: ElectronApplication,
    mainWindow: Page,
    dataDir: string
): Promise<void> {
    if (storedStartupWindowMode(dataDir) !== 'normal') return;
    const narrowWidth = await mainWindow.evaluate(() => window.innerWidth);
    const widened = await application.evaluate(({ BrowserWindow }, width) => {
        const [window] = BrowserWindow.getAllWindows();
        if (!window || window.isFullScreen()) return false;
        const [contentWidth, contentHeight] = window.getContentSize();
        if (contentWidth >= width) return false;
        window.setContentSize(width, contentHeight);
        return true;
    }, DEFAULT_E2E_WINDOW_WIDTH);
    if (!widened) return;

    // Wait for the renderer to lay out at the new size. A restored zoom
    // scales the CSS width, so the target is "wider than before", not a
    // fixed number of CSS pixels.
    await mainWindow
        .waitForFunction((width) => window.innerWidth > width, narrowWidth, {
            timeout: 5000,
        })
        .catch(() => undefined);
    // Fail here, not in a later spec's category click, when the window did
    // not take the new size.
    const contentWidth = await application.evaluate(
        ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]?.getContentSize()[0] ?? 0
    );
    if (contentWidth < DEFAULT_E2E_WINDOW_WIDTH) {
        throw new Error(
            `E2E window stayed ${contentWidth}px wide; expected ${DEFAULT_E2E_WINDOW_WIDTH}px.`
        );
    }
}
