import type { ElectronApplication, Page } from '@playwright/test';

/** The width the app opens at on a screen at least this wide. */
export const DEFAULT_E2E_WINDOW_WIDTH = 1280;

/**
 * The app opens at `min(1280, work area)` wide (app.ts). The Windows and
 * macOS CI runners have 1024px screens, which puts every test inside the
 * compact Live TV band (641–1100px, UI-67) where the categories rail folds
 * away. Specs are written against the default desktop width, so a launch
 * narrower than it is widened to it; tests that need a narrow window resize
 * it themselves. Fullscreen and maximized launches keep their size.
 */
export async function widenToDefaultDesktopWidth(
    application: ElectronApplication,
    mainWindow: Page
): Promise<void> {
    const widened = await application.evaluate(({ BrowserWindow }, width) => {
        const [window] = BrowserWindow.getAllWindows();
        if (!window || window.isFullScreen() || window.isMaximized()) {
            return false;
        }
        const [contentWidth, contentHeight] = window.getContentSize();
        if (contentWidth >= width) return false;
        window.setContentSize(width, contentHeight);
        return true;
    }, DEFAULT_E2E_WINDOW_WIDTH);
    if (!widened) return;

    await mainWindow.waitForFunction(
        (width) => window.innerWidth >= width,
        // Zoomed renderers report fewer CSS pixels; the compact band's upper
        // edge is the width that must be cleared.
        1101,
        { timeout: 5000 }
    );
}
