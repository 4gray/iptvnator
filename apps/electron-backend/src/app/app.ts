import { app, BrowserWindow, Menu, screen, session, shell } from 'electron';
import { WINDOW_STATE_CHANGED } from '@iptvnator/shared/interfaces';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { rendererAppName, rendererAppPort } from './constants';
import {
    isStartupTraceEnabled,
    isRendererConsoleTraceEnabled,
    isWindowTraceEnabled,
    trace,
} from './services/debug-trace';
import { store, WINDOW_BOUNDS } from './services/store.service';

const externalBrowserProtocols = new Set(['http:', 'https:']);
const trustedDevRendererHosts = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
    '::1',
]);

function parseUrl(url: string): URL | null {
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

function getPackagedRendererIndexPath(): string {
    return resolve(__dirname, '..', rendererAppName, 'index.html');
}

function getFilePathFromUrl(url: URL): string | null {
    try {
        return fileURLToPath(url);
    } catch {
        return null;
    }
}

export function isExternalBrowserUrl(url: string): boolean {
    const parsedUrl = parseUrl(url);
    return Boolean(
        parsedUrl && externalBrowserProtocols.has(parsedUrl.protocol)
    );
}

export function isTrustedRendererNavigationUrl(
    url: string,
    isDevelopmentMode: boolean,
    packagedRendererIndexPath = getPackagedRendererIndexPath()
): boolean {
    const parsedUrl = parseUrl(url);

    if (!parsedUrl) {
        return false;
    }

    if (parsedUrl.protocol === 'file:') {
        const filePath = getFilePathFromUrl(parsedUrl);

        if (isDevelopmentMode || !filePath) {
            return false;
        }

        return resolve(filePath) === resolve(packagedRendererIndexPath);
    }

    if (!isDevelopmentMode) {
        return false;
    }

    return (
        parsedUrl.protocol === 'http:' &&
        trustedDevRendererHosts.has(parsedUrl.hostname) &&
        parsedUrl.port === String(rendererAppPort)
    );
}

export function getMainWindowWebPreferences(): Electron.BrowserWindowConstructorOptions['webPreferences'] {
    return {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        preload: join(__dirname, 'main.preload.js'),
    };
}

export async function clearElectronServiceWorkerStorage(
    electronSession: Pick<Electron.Session, 'clearStorageData'> = session.defaultSession
): Promise<void> {
    try {
        await electronSession.clearStorageData({
            storages: ['serviceworkers', 'cachestorage'],
        });

        if (isStartupTraceEnabled()) {
            trace('startup', 'electron-service-worker-storage:cleared');
        }
    } catch (error) {
        console.warn('Failed to clear Electron service worker storage:', error);

        if (isStartupTraceEnabled()) {
            trace(
                'startup',
                'electron-service-worker-storage:clear-failed',
                error
            );
        }
    }
}

function attachWindowTrace(mainWindow: Electron.BrowserWindow): void {
    if (!isWindowTraceEnabled()) {
        return;
    }

    const webContents = mainWindow.webContents;

    trace('window', 'created', {
        id: mainWindow.id,
    });

    mainWindow.on('unresponsive', () => {
        trace('window', 'unresponsive', {
            id: mainWindow.id,
            url: webContents.getURL(),
        });
    });
    mainWindow.on('responsive', () => {
        trace('window', 'responsive', {
            id: mainWindow.id,
            url: webContents.getURL(),
        });
    });

    webContents.on('did-start-loading', () => {
        trace('window', 'did-start-loading', {
            id: mainWindow.id,
            url: webContents.getURL(),
        });
    });
    webContents.on('dom-ready', () => {
        trace('window', 'dom-ready', {
            id: mainWindow.id,
            url: webContents.getURL(),
        });
    });
    webContents.on('did-finish-load', () => {
        trace('window', 'did-finish-load', {
            id: mainWindow.id,
            url: webContents.getURL(),
        });
    });
    webContents.on(
        'did-fail-load',
        (_event, errorCode, errorDescription, validatedURL) => {
            trace('window', 'did-fail-load', {
                errorCode,
                errorDescription,
                id: mainWindow.id,
                validatedURL,
            });
        }
    );
    webContents.on('did-navigate', (_event, url) => {
        trace('window', 'did-navigate', {
            id: mainWindow.id,
            url,
        });
    });
    webContents.on('render-process-gone', (_event, details) => {
        trace('window', 'render-process-gone', {
            details,
            id: mainWindow.id,
            url: webContents.getURL(),
        });
    });

    if (isRendererConsoleTraceEnabled()) {
        webContents.on(
            'console-message',
            (_event, level, message, line, sourceId) => {
                trace('renderer-console', 'message', {
                    level,
                    line,
                    message,
                    sourceId,
                });
            }
        );
    }
}

export default class App {
    // Keep a global reference of the window object, if you don't, the window will
    // be closed automatically when the JavaScript object is garbage collected.
    static mainWindow: Electron.BrowserWindow | null = null;
    static application: Electron.App;
    static BrowserWindow;
    private static loadedMainWindow: Electron.BrowserWindow | null = null;
    private static mainWindowLoadPromise: Promise<void> | null = null;
    private static rendererLoadingEnabled = false;

    private static shouldOpenDevTools() {
        return process.env.ELECTRON_OPEN_DEVTOOLS === '1';
    }

    public static isDevelopmentMode() {
        // First check ELECTRON_IS_DEV environment variable (used by E2E tests)
        // This allows E2E tests to run in production mode without packaging
        if ('ELECTRON_IS_DEV' in process.env) {
            return parseInt(process.env.ELECTRON_IS_DEV, 10) === 1;
        }
        // Fall back to Electron's built-in app.isPackaged
        // This is the most reliable way to detect if the app is packaged
        return !app.isPackaged;
    }

    private static onWindowAllClosed() {
        if (process.platform !== 'darwin') {
            App.application.quit();
        }
    }

    private static onClose() {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        App.mainWindow = null;
    }

    private static startMainWindowLoad(): void {
        void App.loadMainWindow().catch((error) => {
            console.error('Failed to load main window:', error);
        });
    }

    private static onReady() {
        // This method will be called when Electron has finished
        // initialization and is ready to create browser windows.
        // Some APIs can only be used after this event occurs.
        if (rendererAppName) {
            App.initMainWindow();
            if (App.rendererLoadingEnabled) {
                App.startMainWindowLoad();
            }
        }
    }

    private static onActivate() {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (App.mainWindow === null) {
            App.onReady();
        }
        if (App.rendererLoadingEnabled) {
            App.startMainWindowLoad();
        }
    }

    private static handleRendererNavigation(
        event: Electron.Event,
        url: string
    ): void {
        if (isTrustedRendererNavigationUrl(url, App.isDevelopmentMode())) {
            return;
        }

        event.preventDefault();

        if (isExternalBrowserUrl(url)) {
            shell.openExternal(url);
        }
    }

    /**
     * Hide the native title bar on every desktop platform. macOS keeps the
     * system traffic lights (overlay), while Windows/Linux rely on the
     * renderer-drawn window controls (`app-window-controls`) wired up via the
     * WINDOW:* IPC channels. `frame` stays untouched so native resize borders
     * and snapping keep working.
     */
    private static getPlatformTitleBarOptions(): Electron.BrowserWindowConstructorOptions {
        if (process.platform === 'darwin') {
            return {
                titleBarStyle: 'hidden',
                titleBarOverlay: true,
                trafficLightPosition: { x: 16, y: 20 },
            };
        }

        return { titleBarStyle: 'hidden' };
    }

    private static attachWindowStateEvents(win: Electron.BrowserWindow): void {
        // Only Windows/Linux render custom window controls that subscribe
        // to these pushes; macOS keeps the native traffic lights, so
        // sending state updates there would be dead IPC traffic.
        if (process.platform === 'darwin') {
            return;
        }

        const sendWindowState = () => {
            if (win.isDestroyed()) {
                return;
            }

            win.webContents.send(WINDOW_STATE_CHANGED, {
                isMaximized: win.isMaximized(),
                isFullScreen: win.isFullScreen(),
            });
        };

        win.on('maximize', sendWindowState);
        win.on('unmaximize', sendWindowState);
        win.on('enter-full-screen', sendWindowState);
        win.on('leave-full-screen', sendWindowState);
    }

    private static initMainWindow() {
        const workAreaSize = screen.getPrimaryDisplay().workAreaSize;
        const width = Math.min(1280, workAreaSize.width || 1280);
        const height = Math.min(720, workAreaSize.height || 720);

        const savedWindowBounds = store.get(WINDOW_BOUNDS);

        // Create the browser window.
        App.mainWindow = new BrowserWindow({
            title: 'IPTVnator',
            width: width,
            height: height,
            show: false,
            webPreferences: getMainWindowWebPreferences(),
            ...savedWindowBounds,
            minHeight: 600,
            minWidth: 900,
            ...App.getPlatformTitleBarOptions(),
        });
        App.mainWindow.setMenu(null);
        attachWindowTrace(App.mainWindow);
        App.attachWindowStateEvents(App.mainWindow);
        if (!savedWindowBounds) {
            App.mainWindow.center();
        }

        // if main window is ready to show, close the splash window and show the main window
        App.mainWindow.once('ready-to-show', () => {
            App.mainWindow.show();
        });

        // Route target="_blank" / window.open() to the OS default browser
        App.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (isExternalBrowserUrl(url)) {
                shell.openExternal(url);
            }
            return { action: 'deny' };
        });

        App.mainWindow.webContents.on(
            'will-navigate',
            App.handleRendererNavigation
        );
        App.mainWindow.webContents.on(
            'will-redirect',
            App.handleRendererNavigation
        );

        // Emitted when the window is closed.
        App.mainWindow.on('closed', () => {
            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
            App.mainWindow = null;
            App.loadedMainWindow = null;
            App.mainWindowLoadPromise = null;
        });

        App.mainWindow.on('close', () => {
            if (App.mainWindow) {
                store.set(WINDOW_BOUNDS, App.mainWindow.getNormalBounds());
            }
        });

        // Enable context menu for input fields only
        App.mainWindow.webContents.on('context-menu', (event, params) => {
            const { isEditable, editFlags } = params;

            // Check if this is an editable field (input, textarea, contenteditable)
            // editFlags.canPaste is a good indicator of an input field
            if (isEditable && editFlags.canPaste) {
                const menu = Menu.buildFromTemplate([
                    {
                        label: 'Cut',
                        role: 'cut',
                        enabled: editFlags.canCut,
                    },
                    {
                        label: 'Copy',
                        role: 'copy',
                        enabled: editFlags.canCopy,
                    },
                    {
                        label: 'Paste',
                        role: 'paste',
                        enabled: editFlags.canPaste,
                    },
                    {
                        type: 'separator',
                    },
                    {
                        label: 'Select All',
                        role: 'selectAll',
                        enabled: editFlags.canSelectAll,
                    },
                ]);

                menu.popup();
            }
        });
    }

    private static async loadMainWindowContent(
        mainWindow: Electron.BrowserWindow
    ): Promise<void> {
        // load the index.html of the app.
        if (App.isDevelopmentMode()) {
            const loadPromise = mainWindow.loadURL(
                `http://localhost:${rendererAppPort}`
            );
            if (App.shouldOpenDevTools()) {
                mainWindow.webContents.openDevTools();
            }
            await loadPromise;
        } else {
            await clearElectronServiceWorkerStorage();
            await mainWindow.loadFile(getPackagedRendererIndexPath());
        }
    }

    static async loadMainWindow(): Promise<void> {
        App.rendererLoadingEnabled = true;

        if (!rendererAppName || !App.mainWindow) {
            return;
        }

        if (App.loadedMainWindow === App.mainWindow) {
            return;
        }

        if (!App.mainWindowLoadPromise) {
            const mainWindow = App.mainWindow;
            App.mainWindowLoadPromise = App.loadMainWindowContent(mainWindow)
                .then(() => {
                    App.loadedMainWindow = mainWindow;
                })
                .finally(() => {
                    App.mainWindowLoadPromise = null;
                });
        }

        await App.mainWindowLoadPromise;
    }

    static main(app: Electron.App, browserWindow: typeof BrowserWindow) {
        // we pass the Electron.App object and the
        // Electron.BrowserWindow into this function
        // so this class has no dependencies. This
        // makes the code easier to write tests for

        App.BrowserWindow = browserWindow;
        App.application = app;

        App.application.on('window-all-closed', App.onWindowAllClosed); // Quit when all windows are closed.
        if (App.application.isReady()) {
            App.onReady();
        } else {
            App.application.on('ready', App.onReady); // App is ready to load data
        }
        App.application.on('activate', App.onActivate); // App is activated
        App.application.on('before-quit', () => {
            if (App.mainWindow)
                store.set(WINDOW_BOUNDS, App.mainWindow.getNormalBounds());
        });
    }
}
