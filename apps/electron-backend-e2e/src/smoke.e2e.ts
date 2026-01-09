import {
    _electron as electron,
    ElectronApplication,
    expect,
    Page,
    test,
} from '@playwright/test';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Smoke test for the Electron application.
 * Verifies that the app starts correctly and renders the main window.
 */

let electronApp: ElectronApplication;
let mainWindow: Page;

// Workspace root (where nx.json is located)
const workspaceRoot = resolve(__dirname, '../../..');

// Path to the packaged Electron app main.js file
const electronMainPath = join(
    workspaceRoot,
    'dist/apps/electron-backend/main.js'
);

// Path for screenshots
const screenshotDir = join(
    workspaceRoot,
    'dist/test-results/electron-backend-e2e'
);

// Ensure screenshot directory exists
if (!existsSync(screenshotDir)) {
    mkdirSync(screenshotDir, { recursive: true });
}

/**
 * Helper to find the main application window (not DevTools)
 */
async function findMainWindow(app: ElectronApplication): Promise<Page> {
    // Wait for windows to be available
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const windows = app.windows();
    console.log(`Found ${windows.length} window(s)`);

    for (const window of windows) {
        const title = await window.title();
        console.log(`Window title: "${title}"`);
        // Skip DevTools windows
        if (!title.includes('DevTools')) {
            return window;
        }
    }

    // If no non-DevTools window found, wait for one
    console.log('Waiting for main window...');
    return await app.firstWindow();
}

test.describe('Electron App Smoke Test', () => {
    test.beforeAll(async () => {
        console.log(`Launching Electron app from: ${electronMainPath}`);
        console.log(`Platform: ${process.platform}`);
        console.log(`CI: ${process.env['CI']}`);

        // Check if web build exists
        const webIndexPath = join(workspaceRoot, 'dist/apps/web/index.html');
        console.log(`Web index path: ${webIndexPath}`);
        console.log(`Web index exists: ${existsSync(webIndexPath)}`);

        // Launch the Electron app
        // On Linux CI, we need to disable sandbox due to permission issues
        const args = [electronMainPath];
        if (process.platform === 'linux' && process.env['CI']) {
            args.unshift('--no-sandbox', '--disable-gpu');
        }

        electronApp = await electron.launch({
            args,
            env: {
                ...process.env,
                NODE_ENV: 'test',
                ELECTRON_IS_DEV: '0',
            },
        });

        // Find the main application window (not DevTools)
        mainWindow = await findMainWindow(electronApp);

        // Wait for the window to be fully loaded
        await mainWindow.waitForLoadState('domcontentloaded');

        // Debug: Log the current URL
        const url = mainWindow.url();
        console.log(`Page URL: ${url}`);

        // Wait for Angular to bootstrap and render
        await mainWindow.waitForSelector('app-root', { timeout: 30000 });

        // Wait for Angular to fully initialize and set the title
        await mainWindow.waitForFunction(
            () => document.title.length > 0,
            { timeout: 30000 }
        );

        console.log('Electron app launched successfully');
    });

    test.afterAll(async () => {
        if (electronApp) {
            await electronApp.close();
        }
    });

    test('app should start and display main window', async () => {
        expect(mainWindow).toBeTruthy();

        await mainWindow.screenshot({
            path: join(screenshotDir, 'smoke-test-screenshot.png'),
            fullPage: true,
        });

        const title = await mainWindow.title();
        console.log(`Window title: ${title}`);
        expect(title).toContain('IPTVnator');
    });

    test('app should have expected window properties', async () => {
        const isVisible = await electronApp.evaluate(({ BrowserWindow }) => {
            const mainWindow = BrowserWindow.getAllWindows()[0];
            return mainWindow ? mainWindow.isVisible() : false;
        });
        expect(isVisible).toBe(true);

        const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
            const mainWindow = BrowserWindow.getAllWindows()[0];
            return mainWindow ? mainWindow.getBounds() : null;
        });
        expect(bounds).not.toBeNull();
        expect(bounds?.width).toBeGreaterThan(800);
        expect(bounds?.height).toBeGreaterThan(600);

        await mainWindow.screenshot({
            path: join(screenshotDir, 'window-properties-screenshot.png'),
        });
    });

    test('app should render main content', async () => {
        // Wait for app-root to have actual content
        await mainWindow.waitForFunction(
            () => {
                const appRoot = document.querySelector('app-root');
                return appRoot && appRoot.innerHTML.trim().length > 0;
            },
            { timeout: 30000 }
        );

        const bodyContent = await mainWindow.locator('body').innerHTML();
        expect(bodyContent.length).toBeGreaterThan(0);

        await mainWindow.screenshot({
            path: join(screenshotDir, 'rendered-content-screenshot.png'),
            fullPage: true,
        });

        console.log('Smoke test completed successfully');
    });
});
