import { app, BrowserWindow, Menu, screen, session, shell } from 'electron';
import {
    ElectronBridgeWindowState,
    WINDOW_STATE_CHANGED,
} from '@iptvnator/shared/interfaces';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { rendererAppName, rendererAppPort } from './constants';
import {
    isStartupTraceEnabled,
    isRendererConsoleTraceEnabled,
    isWindowTraceEnabled,
    trace,
} from './services/debug-trace';
import {
    STARTUP_WINDOW_MODE,
    store,
    WINDOW_BOUNDS,
} from './services/store.service';
import { isFrameCopyRuntimeUsable } from './services/embedded-mpv-frame-copy-platform.util';
import { isEmbeddedMpvFeatureEnabled } from './services/embedded-mpv-runtime-policy.util';
import {
    FULLSCREEN_LAUNCH_SWITCH,
    resolveStartupWindowMode,
} from './services/startup-window-mode';

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
    // The frame-copy embedded MPV experiment needs the preload script to
    // load the shm frame-reader native addon, which the renderer sandbox
    // forbids. Only that opt-in flag relaxes the sandbox; context isolation
    // and nodeIntegration:false stay on either way, so page code never
    // gains Node access. Revisit before the engine can become a default.
    const frameCopyExperiment =
        isEmbeddedMpvFeatureEnabled() &&
        ['1', 'true', 'yes', 'on'].includes(
            (process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY ?? '')
                .trim()
                .toLowerCase()
        ) && isFrameCopyRuntimeUsable();
    return {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: !frameCopyExperiment,
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
    private static readonly mainWindowListeners: Array<
        (mainWindow: Electron.BrowserWindow) => void
    > = [];
    static application: Electron.App;
    static BrowserWindow;
    private static loadedMainWindow: Electron.BrowserWindow | null = null;
    private static mainWindowLoadPromise: Promise<void> | null = null;
    /**
     * Whether the `--fullscreen` launch switch has already shaped a window.
     * See initMainWindow: the switch is consumed by the first window so a
     * window re-created later in the same process (macOS Dock) follows the
     * stored setting instead.
     */
    private static launchFullscreenSwitchConsumed = false;
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

    /**
     * Registers a listener that needs the current main window, and re-runs it
     * whenever a new one is created.
     *
     * The main window is not created once per process: on macOS the window can
     * be closed and rebuilt (dock `activate`, or a second launch handed over by
     * the single-instance guard) while the process lives on. Anything that
     * caches the window — `download-broadcast`'s module-level reference, for
     * one — would otherwise keep pointing at a destroyed window and silently
     * stop delivering to the renderer. Fires immediately when a window already
     * exists, so callers registering after startup do not miss the first one.
     */
    static onMainWindowCreated(
        listener: (mainWindow: Electron.BrowserWindow) => void
    ): void {
        App.mainWindowListeners.push(listener);

        if (App.mainWindow && !App.mainWindow.isDestroyed()) {
            listener(App.mainWindow);
        }
    }

    private static notifyMainWindowCreated(
        mainWindow: Electron.BrowserWindow
    ): void {
        for (const listener of App.mainWindowListeners) {
            listener(mainWindow);
        }
    }

    /**
     * Brings the app back to a windowed state, re-creating the main window if
     * it is gone.
     *
     * On macOS closing the last window deliberately keeps the process alive
     * (`onWindowAllClosed`), so this is the recovery path for both the dock
     * `activate` event and a second launch that the single-instance guard
     * hands over to this process.
     */
    static ensureMainWindow() {
        if (App.mainWindow === null) {
            App.onReady();
        }
        if (App.rendererLoadingEnabled) {
            App.startMainWindowLoad();
        }
    }

    private static onActivate() {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        App.ensureMainWindow();
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

        // Window state is never re-read at event time: on Windows both
        // isFullScreen() and isMaximized() can still report the
        // pre-transition value while the matching event fires (notably for
        // HTML-element fullscreen, i.e. the video player). Since the
        // renderer replaces both flags on every push and no later event
        // corrects a stale one, polling left the controls hidden forever
        // after leaving fullscreen — and, for the companion flag, the
        // maximize/restore glyph stuck on the wrong icon.
        //
        // Instead the state is seeded once here (window creation, so no
        // transition is in flight) and each event patches only the flag it
        // names.
        const state: ElectronBridgeWindowState = {
            isMaximized: win.isMaximized(),
            isFullScreen: win.isFullScreen(),
        };

        // Native (OS-level) and HTML-element fullscreen are tracked apart
        // and OR-ed into the pushed flag. Electron remembers when the window
        // was already natively fullscreen before the player entered HTML
        // fullscreen and then leaves ONLY the HTML state on exit — no
        // 'leave-full-screen' fires and the window stays fullscreen. A single
        // flag cleared by 'leave-html-full-screen' would un-hide the window
        // controls over a window that is still fullscreen, which a fullscreen
        // launch or F11 followed by the player's F → Esc makes routine.
        const fullscreen = { native: state.isFullScreen, html: false };

        const push = (patch: Partial<ElectronBridgeWindowState>) => {
            Object.assign(state, patch);

            if (win.isDestroyed()) {
                return;
            }

            // A copy per push: the renderer must not observe later
            // mutations of the tracked state.
            win.webContents.send(WINDOW_STATE_CHANGED, { ...state });
        };
        const pushFullScreen = () =>
            push({ isFullScreen: fullscreen.native || fullscreen.html });

        win.on('maximize', () => push({ isMaximized: true }));
        win.on('unmaximize', () => push({ isMaximized: false }));
        // The html variants cover HTML-element fullscreen; not every
        // platform/trigger emits both pairs, and duplicate pushes with the
        // same payload are harmless.
        win.on('enter-full-screen', () => {
            fullscreen.native = true;
            pushFullScreen();
        });
        win.on('leave-full-screen', () => {
            fullscreen.native = false;
            pushFullScreen();
        });
        win.on('enter-html-full-screen', () => {
            fullscreen.html = true;
            pushFullScreen();
        });
        win.on('leave-html-full-screen', () => {
            fullscreen.html = false;
            pushFullScreen();
        });
    }

    private static initMainWindow() {
        const workAreaSize = screen.getPrimaryDisplay().workAreaSize;
        const width = Math.min(1280, workAreaSize.width || 1280);
        const height = Math.min(720, workAreaSize.height || 720);

        const savedWindowBounds = store.get(WINDOW_BOUNDS);
        const startupWindowMode = resolveStartupWindowMode({
            // One-shot: the switch describes the launch, not every window
            // this process ever opens. On macOS the process outlives its
            // last window and the Dock re-creates it through this same
            // path, which must then follow the stored setting only.
            cliHasFullscreenSwitch:
                !App.launchFullscreenSwitchConsumed &&
                app.commandLine.hasSwitch(FULLSCREEN_LAUNCH_SWITCH),
            storedMode: store.get(STARTUP_WINDOW_MODE),
        });
        App.launchFullscreenSwitchConsumed = true;

        // Create the browser window.
        App.mainWindow = new BrowserWindow({
            title: 'IPTVnator',
            width: width,
            height: height,
            show: false,
            webPreferences: getMainWindowWebPreferences(),
            ...savedWindowBounds,
            // Fullscreen is a constructor option: the window is created
            // hidden and enters fullscreen before its first paint. The saved
            // bounds stay spread in above — they are the normal bounds the
            // window returns to, and the close handler keeps persisting
            // getNormalBounds(), so a fullscreen session never corrupts them.
            ...(startupWindowMode === 'fullscreen' ? { fullscreen: true } : {}),
            minHeight: 600,
            minWidth: 900,
            ...App.getPlatformTitleBarOptions(),
        });
        App.mainWindow.setMenu(null);
        attachWindowTrace(App.mainWindow);
        App.attachWindowStateEvents(App.mainWindow);
        App.notifyMainWindowCreated(App.mainWindow);
        if (!savedWindowBounds) {
            App.mainWindow.center();
        }

        // if main window is ready to show, close the splash window and show the main window
        App.mainWindow.once('ready-to-show', () => {
            // maximize() on a hidden window shows it (Electron docs), so it
            // has to wait for ready-to-show like show() does — any earlier
            // and a blank window flashes before the renderer paints.
            if (startupWindowMode === 'maximized') {
                App.mainWindow.maximize();
            }
            App.mainWindow.show();
            // macOS ignores the constructor's `fullscreen` while the window
            // is hidden — an NSWindow can only toggle fullscreen once it is
            // on screen — so the request is repeated after show() wherever
            // it has not taken yet. Windows/Linux honoured it at creation
            // (before the first paint) and are left alone.
            if (
                startupWindowMode === 'fullscreen' &&
                !App.mainWindow.isFullScreen()
            ) {
                App.mainWindow.setFullScreen(true);
            }
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
