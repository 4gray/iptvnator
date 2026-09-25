const mockClearStorageData = jest.fn();
const mockIsFrameCopyRuntimeUsable = jest.fn<boolean, []>();
const mockIsEmbeddedMpvFeatureEnabled = jest.fn<boolean, []>();
const mockHasSwitch = jest.fn<boolean, [string]>();

jest.mock('electron', () => ({
    app: {
        commandLine: {
            hasSwitch: mockHasSwitch,
        },
        getPath: jest.fn(() => '/tmp'),
        isPackaged: false,
        isReady: jest.fn(() => false),
        on: jest.fn(),
    },
    BrowserWindow: jest.fn(),
    Menu: {
        buildFromTemplate: jest.fn(),
    },
    screen: {
        getPrimaryDisplay: jest.fn(),
    },
    session: {
        defaultSession: {
            clearStorageData: mockClearStorageData,
        },
    },
    shell: {
        openExternal: jest.fn(),
    },
}));

jest.mock('./services/store.service', () => ({
    store: {
        get: jest.fn(),
        set: jest.fn(),
    },
    STARTUP_WINDOW_MODE: 'startupWindowMode',
    WINDOW_BOUNDS: 'windowBounds',
    ZOOM_LEVEL: 'zoomLevel',
}));

jest.mock('./services/embedded-mpv-frame-copy-platform.util', () => ({
    isFrameCopyRuntimeUsable: mockIsFrameCopyRuntimeUsable,
}));

jest.mock('./services/embedded-mpv-runtime-policy.util', () => ({
    isEmbeddedMpvFeatureEnabled: mockIsEmbeddedMpvFeatureEnabled,
}));

import {
    clearElectronServiceWorkerStorage,
    getMainWindowWebPreferences,
    isExternalBrowserUrl,
    isTrustedRendererNavigationUrl,
} from './app';
import App from './app';
import { app as electronApp, BrowserWindow, screen, shell } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { store } from './services/store.service';
import { markZoomLevelApplied } from './services/window-zoom-level';
import { getPendingFullScreenTarget } from './services/native-fullscreen-transitions';

type MockMainWindow = {
    center: jest.Mock<void, []>;
    getNormalBounds: jest.Mock<object, []>;
    // Read once by attachWindowStateEvents to seed the tracked window
    // state; only reached off macOS, where the custom controls exist.
    isDestroyed: jest.Mock<boolean, []>;
    isFullScreen: jest.Mock<boolean, []>;
    isMaximized: jest.Mock<boolean, []>;
    loadFile: jest.Mock<Promise<void>, [string]>;
    loadURL: jest.Mock<Promise<void>, [string]>;
    maximize: jest.Mock<void, []>;
    on: jest.Mock<void, [string, (...args: unknown[]) => void]>;
    once: jest.Mock<void, [string, (...args: unknown[]) => void]>;
    setFullScreen: jest.Mock<void, [boolean]>;
    setMenu: jest.Mock<void, [unknown]>;
    show: jest.Mock<void, []>;
    webContents: {
        on: jest.Mock<void, [string, (...args: unknown[]) => void]>;
        openDevTools: jest.Mock<void, []>;
        setWindowOpenHandler: jest.Mock<void, [unknown]>;
        getZoomLevel: jest.Mock<number, []>;
        isDestroyed: jest.Mock<boolean, []>;
    };
};

function createMockMainWindow(): MockMainWindow {
    return {
        center: jest.fn<void, []>(),
        getNormalBounds: jest.fn<object, []>().mockReturnValue({}),
        isFullScreen: jest.fn<boolean, []>().mockReturnValue(false),
        isMaximized: jest.fn<boolean, []>().mockReturnValue(false),
        loadFile: jest.fn<Promise<void>, [string]>().mockResolvedValue(),
        loadURL: jest.fn<Promise<void>, [string]>().mockResolvedValue(),
        maximize: jest.fn<void, []>(),
        on: jest.fn<void, [string, (...args: unknown[]) => void]>(),
        once: jest.fn<void, [string, (...args: unknown[]) => void]>(),
        isDestroyed: jest.fn<boolean, []>().mockReturnValue(false),
        setFullScreen: jest.fn<void, [boolean]>(),
        setMenu: jest.fn<void, [unknown]>(),
        show: jest.fn<void, []>(),
        webContents: {
            on: jest.fn<void, [string, (...args: unknown[]) => void]>(),
            openDevTools: jest.fn<void, []>(),
            setWindowOpenHandler: jest.fn<void, [unknown]>(),
            getZoomLevel: jest.fn<number, []>().mockReturnValue(0),
            isDestroyed: jest.fn<boolean, []>().mockReturnValue(false),
        },
    };
}

type AppInternals = {
    launchFullscreenSwitchConsumed: boolean;
    loadedMainWindow: MockMainWindow | null;
    mainWindow: MockMainWindow | null;
    mainWindowListeners: Array<(mainWindow: MockMainWindow) => void>;
    mainWindowLoadPromise: Promise<void> | null;
    onReady: () => void;
    rendererLoadingEnabled: boolean;
    loadMainWindow: () => Promise<void>;
};

function getAppInternals(): AppInternals {
    return App as unknown as AppInternals;
}

describe('Electron app security helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.ELECTRON_IS_DEV;
        delete process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT;
        delete process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY;
        mockIsEmbeddedMpvFeatureEnabled.mockReturnValue(false);
        mockIsFrameCopyRuntimeUsable.mockReturnValue(false);
        const appInternals = getAppInternals();
        appInternals.launchFullscreenSwitchConsumed = false;
        appInternals.loadedMainWindow = null;
        appInternals.mainWindow = null;
        appInternals.mainWindowLoadPromise = null;
        appInternals.rendererLoadingEnabled = false;
        appInternals.mainWindowListeners.length = 0;
        (electronApp as unknown as { isPackaged: boolean }).isPackaged = false;
        (screen.getPrimaryDisplay as jest.Mock).mockReturnValue({
            workAreaSize: { height: 720, width: 1280 },
        });
        (store.get as jest.Mock).mockReturnValue(undefined);
        mockHasSwitch.mockReturnValue(false);
    });

    it('creates an explicitly hardened BrowserWindow webPreferences object', () => {
        expect(getMainWindowWebPreferences()).toEqual(
            expect.objectContaining({
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                webSecurity: true,
                backgroundThrottling: false,
            })
        );
    });

    it('keeps the renderer sandboxed when frame-copy is requested without a usable runtime', () => {
        process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY = '1';
        mockIsEmbeddedMpvFeatureEnabled.mockReturnValue(true);

        expect(getMainWindowWebPreferences()?.sandbox).toBe(true);
        expect(mockIsFrameCopyRuntimeUsable).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, '0'])(
        'does not probe frame-copy runtime for an inactive %s opt-in',
        (explicitFrameCopy) => {
            mockIsEmbeddedMpvFeatureEnabled.mockReturnValue(true);
            if (explicitFrameCopy === undefined) {
                delete process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY;
            } else {
                process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY =
                    explicitFrameCopy;
            }

            expect(getMainWindowWebPreferences()?.sandbox).toBe(true);
            expect(mockIsFrameCopyRuntimeUsable).not.toHaveBeenCalled();
        }
    );

    it('probes frame-copy runtime for an explicit opt-in', () => {
        process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY = '1';
        mockIsEmbeddedMpvFeatureEnabled.mockReturnValue(true);

        expect(getMainWindowWebPreferences()?.sandbox).toBe(true);
        expect(mockIsFrameCopyRuntimeUsable).toHaveBeenCalledTimes(1);
    });

    it('keeps the renderer sandboxed when frame-copy is requested but embedded MPV is disabled', () => {
        process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY = '1';
        mockIsFrameCopyRuntimeUsable.mockReturnValue(true);

        expect(getMainWindowWebPreferences()?.sandbox).toBe(true);
    });

    it('relaxes the renderer sandbox only when embedded MPV and a usable frame-copy runtime are enabled', () => {
        process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY = '1';
        mockIsEmbeddedMpvFeatureEnabled.mockReturnValue(true);
        mockIsFrameCopyRuntimeUsable.mockReturnValue(true);

        expect(getMainWindowWebPreferences()?.sandbox).toBe(false);
    });

    it('treats only http and https URLs as external browser URLs', () => {
        expect(isExternalBrowserUrl('https://example.com')).toBe(true);
        expect(isExternalBrowserUrl('http://example.com')).toBe(true);
        expect(isExternalBrowserUrl('file:///tmp/index.html')).toBe(false);
        expect(isExternalBrowserUrl('javascript:alert(1)')).toBe(false);
        expect(isExternalBrowserUrl('not a url')).toBe(false);
    });

    it('allows only the dev server origin in development navigation', () => {
        expect(
            isTrustedRendererNavigationUrl('http://localhost:4200/home', true)
        ).toBe(true);
        expect(
            isTrustedRendererNavigationUrl('http://127.0.0.1:4200/home', true)
        ).toBe(true);
        expect(
            isTrustedRendererNavigationUrl('http://[::1]:4200/home', true)
        ).toBe(true);
        expect(
            isTrustedRendererNavigationUrl('http://localhost:4300/home', true)
        ).toBe(false);
        expect(
            isTrustedRendererNavigationUrl('https://example.com', true)
        ).toBe(false);
        expect(
            isTrustedRendererNavigationUrl('file:///tmp/index.html', true)
        ).toBe(false);
    });

    it('allows only the packaged renderer file in packaged navigation', () => {
        // Resolve to host-native absolute paths: POSIX-style file URLs such
        // as file:///tmp/... are not valid win32 file URLs (no drive letter).
        const packagedIndexPath = path.resolve('/tmp/iptvnator/index.html');
        const otherIndexPath = path.resolve('/tmp/other/index.html');

        expect(
            isTrustedRendererNavigationUrl(
                pathToFileURL(packagedIndexPath).href,
                false,
                packagedIndexPath
            )
        ).toBe(true);
        expect(
            isTrustedRendererNavigationUrl(
                pathToFileURL(otherIndexPath).href,
                false,
                packagedIndexPath
            )
        ).toBe(false);
        expect(
            isTrustedRendererNavigationUrl('https://example.com', false)
        ).toBe(false);
    });

    it('clears Electron service worker storage before loading the packaged renderer', async () => {
        const appInternals = getAppInternals();
        const mainWindow = createMockMainWindow();
        appInternals.mainWindow = mainWindow;
        (electronApp as unknown as { isPackaged: boolean }).isPackaged = true;

        await appInternals.loadMainWindow();

        expect(mockClearStorageData).toHaveBeenCalledWith({
            storages: ['serviceworkers', 'cachestorage'],
        });
        expect(mainWindow.loadFile).toHaveBeenCalledWith(
            expect.stringContaining('index.html')
        );
        expect(mockClearStorageData.mock.invocationCallOrder[0]).toBeLessThan(
            mainWindow.loadFile.mock.invocationCallOrder[0]
        );
    });

    it('continues packaged renderer loading when Electron service worker cleanup fails', async () => {
        const appInternals = getAppInternals();
        const mainWindow = createMockMainWindow();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        appInternals.mainWindow = mainWindow;
        (electronApp as unknown as { isPackaged: boolean }).isPackaged = true;
        mockClearStorageData.mockRejectedValueOnce(new Error('cleanup failed'));

        await appInternals.loadMainWindow();

        expect(mainWindow.loadFile).toHaveBeenCalledWith(
            expect.stringContaining('index.html')
        );
        expect(warnSpy).toHaveBeenCalledWith(
            'Failed to clear Electron service worker storage:',
            expect.any(Error)
        );

        warnSpy.mockRestore();
    });

    it('defers renderer loading until the main process explicitly enables it', async () => {
        const appInternals = getAppInternals();
        const mainWindow = createMockMainWindow();
        (BrowserWindow as unknown as jest.Mock).mockReturnValue(mainWindow);

        appInternals.onReady();

        expect(BrowserWindow).toHaveBeenCalledWith(
            expect.objectContaining({
                show: false,
                webPreferences: expect.objectContaining({
                    preload: expect.stringContaining('main.preload.js'),
                }),
            })
        );
        expect(mainWindow.loadURL).not.toHaveBeenCalled();
        expect(mainWindow.loadFile).not.toHaveBeenCalled();

        await appInternals.loadMainWindow();

        expect(mainWindow.loadURL).toHaveBeenCalledWith(
            'http://localhost:4200'
        );
    });

    describe('startup window mode', () => {
        function createWindowViaOnReady(): MockMainWindow {
            const mainWindow = createMockMainWindow();
            (BrowserWindow as unknown as jest.Mock).mockReturnValue(mainWindow);
            getAppInternals().onReady();
            return mainWindow;
        }

        function fireReadyToShow(mainWindow: MockMainWindow): void {
            const handlers = mainWindow.once.mock.calls
                .filter(([eventName]) => eventName === 'ready-to-show')
                .map(([, handler]) => handler);

            expect(handlers).toHaveLength(1);
            handlers[0]();
        }

        function storeStartupWindowMode(mode: string): void {
            (store.get as jest.Mock).mockImplementation((key: string) =>
                key === 'startupWindowMode' ? mode : undefined
            );
        }

        it('creates a plain window when nothing is stored', () => {
            const mainWindow = createWindowViaOnReady();

            expect(BrowserWindow).toHaveBeenCalledWith(
                expect.not.objectContaining({ fullscreen: true })
            );

            fireReadyToShow(mainWindow);

            expect(mainWindow.maximize).not.toHaveBeenCalled();
            expect(mainWindow.setFullScreen).not.toHaveBeenCalled();
            expect(mainWindow.show).toHaveBeenCalledTimes(1);
        });

        it('creates the window fullscreen when the stored mode says so', () => {
            storeStartupWindowMode('fullscreen');

            const mainWindow = createWindowViaOnReady();
            // Windows/Linux honour the constructor option while the window
            // is still hidden.
            mainWindow.isFullScreen.mockReturnValue(true);

            // Still created hidden: fullscreen is entered before the first
            // paint, and ready-to-show reveals it like any other launch.
            expect(BrowserWindow).toHaveBeenCalledWith(
                expect.objectContaining({ fullscreen: true, show: false })
            );
            fireReadyToShow(mainWindow);
            expect(mainWindow.maximize).not.toHaveBeenCalled();
            expect(mainWindow.show).toHaveBeenCalledTimes(1);
            // Already fullscreen: no second request, which would animate a
            // toggle on top of the one that took.
            expect(mainWindow.setFullScreen).not.toHaveBeenCalled();
        });

        it('repeats the fullscreen request after show() where the constructor option did not take', () => {
            storeStartupWindowMode('fullscreen');

            const mainWindow = createWindowViaOnReady();
            // macOS: an NSWindow only toggles fullscreen once it is on
            // screen, so a hidden window ignores the constructor option.
            mainWindow.isFullScreen.mockReturnValue(false);

            fireReadyToShow(mainWindow);

            expect(mainWindow.setFullScreen).toHaveBeenCalledTimes(1);
            expect(mainWindow.setFullScreen).toHaveBeenCalledWith(true);
            // Registered with the transition tracker, so an F11 pressed
            // during the animation is decided against this target and
            // leaves fullscreen instead of requesting it again.
            expect(
                getPendingFullScreenTarget(
                    mainWindow as unknown as Electron.BrowserWindow
                )
            ).toBe(true);
            expect(mainWindow.show.mock.invocationCallOrder[0]).toBeLessThan(
                mainWindow.setFullScreen.mock.invocationCallOrder[0]
            );
        });

        it('maximizes only once the window is ready to show, before revealing it', () => {
            storeStartupWindowMode('maximized');

            const mainWindow = createWindowViaOnReady();

            expect(BrowserWindow).toHaveBeenCalledWith(
                expect.not.objectContaining({ fullscreen: true })
            );
            // maximize() on a hidden window shows it — a blank flash if it
            // ran here.
            expect(mainWindow.maximize).not.toHaveBeenCalled();

            fireReadyToShow(mainWindow);

            expect(mainWindow.maximize).toHaveBeenCalledTimes(1);
            expect(mainWindow.show).toHaveBeenCalledTimes(1);
            expect(
                mainWindow.maximize.mock.invocationCallOrder[0]
            ).toBeLessThan(mainWindow.show.mock.invocationCallOrder[0]);
        });

        it('lets --fullscreen override the stored mode for this launch without persisting it', () => {
            storeStartupWindowMode('maximized');
            mockHasSwitch.mockImplementation((name) => name === 'fullscreen');

            const mainWindow = createWindowViaOnReady();

            expect(BrowserWindow).toHaveBeenCalledWith(
                expect.objectContaining({ fullscreen: true })
            );
            fireReadyToShow(mainWindow);
            expect(mainWindow.maximize).not.toHaveBeenCalled();
            expect(store.set).not.toHaveBeenCalledWith(
                'startupWindowMode',
                expect.anything()
            );
        });

        it('consumes --fullscreen with the first window so a window re-created from the macOS Dock follows the stored setting', () => {
            storeStartupWindowMode('maximized');
            mockHasSwitch.mockImplementation((name) => name === 'fullscreen');

            const firstWindow = createWindowViaOnReady();
            expect(BrowserWindow).toHaveBeenLastCalledWith(
                expect.objectContaining({ fullscreen: true })
            );
            fireReadyToShow(firstWindow);

            // The user left fullscreen and closed the only window; the
            // process survived and the Dock brings the window back.
            const appInternals = getAppInternals();
            appInternals.mainWindow = null;
            const secondWindow = createMockMainWindow();
            (BrowserWindow as unknown as jest.Mock).mockReturnValue(
                secondWindow
            );

            App.ensureMainWindow();

            expect(BrowserWindow).toHaveBeenCalledTimes(2);
            expect(BrowserWindow).toHaveBeenLastCalledWith(
                expect.not.objectContaining({ fullscreen: true })
            );
            fireReadyToShow(secondWindow);
            expect(secondWindow.setFullScreen).not.toHaveBeenCalled();
            expect(secondWindow.maximize).toHaveBeenCalledTimes(1);
        });

        it('treats a hand-edited unknown stored mode as a plain window', () => {
            storeStartupWindowMode('kiosk');

            const mainWindow = createWindowViaOnReady();

            expect(BrowserWindow).toHaveBeenCalledWith(
                expect.not.objectContaining({ fullscreen: true })
            );
            fireReadyToShow(mainWindow);
            expect(mainWindow.maximize).not.toHaveBeenCalled();
        });
    });

    describe('zoom level persistence', () => {
        const bounds = { x: 1, y: 2, width: 3, height: 4 };

        function createWindowViaOnReady(): MockMainWindow {
            const mainWindow = createMockMainWindow();
            mainWindow.getNormalBounds.mockReturnValue(bounds);
            (BrowserWindow as unknown as jest.Mock).mockReturnValue(mainWindow);
            getAppInternals().onReady();
            return mainWindow;
        }

        // Every listener of the event fires, since the window registers
        // more than one `did-start-navigation` listener (zoom persistence
        // and the renderer reload recovery).
        function fireHandlers(
            calls: Array<[string, (...args: unknown[]) => void]>,
            eventName: string,
            ...args: unknown[]
        ): void {
            const handlers = calls
                .filter(([name]) => name === eventName)
                .map(([, handler]) => handler);

            expect(handlers.length).toBeGreaterThanOrEqual(1);
            for (const handler of handlers) {
                handler(...args);
            }
        }

        function fireWindowEvent(win: MockMainWindow, eventName: string): void {
            fireHandlers(win.on.mock.calls, eventName);
        }

        /** The preload asked for the level: its getZoomLevel() is now the app's. */
        function preloadAppliedZoom(win: MockMainWindow, level: number): void {
            win.webContents.getZoomLevel.mockReturnValue(level);
            markZoomLevelApplied(
                win.webContents as unknown as Electron.WebContents
            );
        }

        it('persists the zoom level next to the bounds when a window whose preload owns the level closes', () => {
            const mainWindow = createWindowViaOnReady();
            preloadAppliedZoom(mainWindow, 1.5);

            fireWindowEvent(mainWindow, 'close');

            expect(store.set).toHaveBeenCalledWith('zoomLevel', 1.5);
            expect(store.set).toHaveBeenCalledWith('windowBounds', bounds);
        });

        it('saves only the bounds when the window closes before its preload applied the level', () => {
            const mainWindow = createWindowViaOnReady();
            // Before the preload handshake getZoomLevel() is Chromium's
            // per-URL default; saving it would clobber the persisted level.
            mainWindow.webContents.getZoomLevel.mockReturnValue(0);

            fireWindowEvent(mainWindow, 'close');

            expect(store.set).not.toHaveBeenCalledWith(
                'zoomLevel',
                expect.anything()
            );
            expect(store.set).toHaveBeenCalledWith('windowBounds', bounds);
        });

        it('does not read zoom from a destroyed webContents on close', () => {
            const mainWindow = createWindowViaOnReady();
            preloadAppliedZoom(mainWindow, 1.5);
            mainWindow.webContents.isDestroyed.mockReturnValue(true);

            fireWindowEvent(mainWindow, 'close');

            expect(mainWindow.webContents.getZoomLevel).not.toHaveBeenCalled();
            expect(store.set).not.toHaveBeenCalledWith(
                'zoomLevel',
                expect.anything()
            );
            expect(store.set).toHaveBeenCalledWith('windowBounds', bounds);
        });

        it('persists the zoom level and bounds on before-quit', () => {
            const mainWindow = createMockMainWindow();
            mainWindow.getNormalBounds.mockReturnValue(bounds);
            (BrowserWindow as unknown as jest.Mock).mockReturnValue(mainWindow);
            (electronApp.isReady as jest.Mock).mockReturnValue(true);
            App.main(electronApp, BrowserWindow);
            preloadAppliedZoom(mainWindow, 2);

            fireHandlers(
                (electronApp.on as jest.Mock).mock.calls,
                'before-quit'
            );

            expect(store.set).toHaveBeenCalledWith('zoomLevel', 2);
            expect(store.set).toHaveBeenCalledWith('windowBounds', bounds);
        });

        it('saves the zoom level right before a reload, which drops the temporary level', () => {
            const mainWindow = createWindowViaOnReady();
            preloadAppliedZoom(mainWindow, 3);

            fireHandlers(
                mainWindow.webContents.on.mock.calls,
                'did-start-navigation',
                { isMainFrame: true, isSameDocument: false }
            );

            expect(store.set).toHaveBeenCalledWith('zoomLevel', 3);
        });

        it('leaves in-app (same-document) routing alone', () => {
            const mainWindow = createWindowViaOnReady();
            preloadAppliedZoom(mainWindow, 3);

            fireHandlers(
                mainWindow.webContents.on.mock.calls,
                'did-start-navigation',
                { isMainFrame: true, isSameDocument: true }
            );

            expect(store.set).not.toHaveBeenCalled();
        });
    });

    describe('renderer reload recovery', () => {
        const rendererRoot = path.dirname(
            path.resolve(__dirname, '..', 'web', 'index.html')
        );
        const routedUrl = pathToFileURL(
            path.join(rendererRoot, 'workspace', 'sources')
        ).href;

        function fireWebContentsEvent(
            win: MockMainWindow,
            eventName: string,
            ...args: unknown[]
        ): void {
            const handlers = win.webContents.on.mock.calls
                .filter(([name]) => name === eventName)
                .map(([, handler]) => handler);

            expect(handlers).toHaveLength(1);
            handlers[0](...args);
        }

        function createPackagedWindow(): MockMainWindow {
            process.env.ELECTRON_IS_DEV = '0';
            const mainWindow = createMockMainWindow();
            (BrowserWindow as unknown as jest.Mock).mockReturnValue(mainWindow);
            getAppInternals().onReady();
            return mainWindow;
        }

        it('re-loads the packaged index with the route a failed file:// reload named', () => {
            const mainWindow = createPackagedWindow();

            fireWebContentsEvent(
                mainWindow,
                'did-fail-load',
                {},
                -6,
                'ERR_FILE_NOT_FOUND',
                routedUrl,
                true
            );
            // Deferred to the error page's dom-ready, or the new document
            // never paints.
            expect(mainWindow.loadFile).not.toHaveBeenCalled();
            fireWebContentsEvent(mainWindow, 'dom-ready');

            expect(mainWindow.loadFile).toHaveBeenCalledWith(
                path.join(rendererRoot, 'index.html'),
                { query: { restoreRoute: 'workspace/sources' } }
            );
        });

        it('sends a renderer-initiated reload of a routed URL to the index instead of cancelling it', () => {
            const mainWindow = createPackagedWindow();
            const event = { preventDefault: jest.fn() };

            fireWebContentsEvent(mainWindow, 'will-navigate', event, routedUrl);

            expect(event.preventDefault).toHaveBeenCalled();
            expect(mainWindow.loadFile).toHaveBeenCalledWith(
                path.join(rendererRoot, 'index.html'),
                { query: { restoreRoute: 'workspace/sources' } }
            );
            expect(shell.openExternal).not.toHaveBeenCalled();
        });

        it('still opens external URLs in the browser and blocks other navigations', () => {
            const mainWindow = createPackagedWindow();
            const external = { preventDefault: jest.fn() };
            const foreignFile = { preventDefault: jest.fn() };

            fireWebContentsEvent(
                mainWindow,
                'will-navigate',
                external,
                'https://example.com/'
            );
            fireWebContentsEvent(
                mainWindow,
                'will-navigate',
                foreignFile,
                pathToFileURL(path.join(rendererRoot, '..', 'other')).href
            );

            expect(external.preventDefault).toHaveBeenCalled();
            expect(shell.openExternal).toHaveBeenCalledWith(
                'https://example.com/'
            );
            expect(foreignFile.preventDefault).toHaveBeenCalled();
            expect(mainWindow.loadFile).not.toHaveBeenCalled();
        });
    });

    it('creates the main window immediately when Electron is already ready', () => {
        const mainWindow = createMockMainWindow();
        (BrowserWindow as unknown as jest.Mock).mockReturnValue(mainWindow);
        (electronApp.isReady as jest.Mock).mockReturnValue(true);

        App.main(electronApp, BrowserWindow);

        expect(BrowserWindow).toHaveBeenCalled();
        expect(electronApp.on).not.toHaveBeenCalledWith(
            'ready',
            expect.any(Function)
        );
        expect(mainWindow.loadURL).not.toHaveBeenCalled();
        expect(mainWindow.loadFile).not.toHaveBeenCalled();
    });

    it('runs a main-window listener immediately when a window already exists', () => {
        const mainWindow = createMockMainWindow();
        (BrowserWindow as unknown as jest.Mock).mockReturnValue(mainWindow);
        (electronApp.isReady as jest.Mock).mockReturnValue(true);
        App.main(electronApp, BrowserWindow);
        const listener = jest.fn();

        App.onMainWindowCreated(
            listener as unknown as (mainWindow: Electron.BrowserWindow) => void
        );

        expect(listener).toHaveBeenCalledWith(mainWindow);
    });

    // macOS keeps the process alive without windows, so anything caching the
    // window (download-broadcast) must be handed the rebuilt one.
    it('re-runs main-window listeners when the window is rebuilt', () => {
        const firstWindow = createMockMainWindow();
        (BrowserWindow as unknown as jest.Mock).mockReturnValue(firstWindow);
        (electronApp.isReady as jest.Mock).mockReturnValue(true);
        App.main(electronApp, BrowserWindow);
        const listener = jest.fn();
        App.onMainWindowCreated(
            listener as unknown as (mainWindow: Electron.BrowserWindow) => void
        );
        listener.mockClear();

        // Simulate the macOS 'closed' handler clearing the reference.
        getAppInternals().mainWindow = null;
        const secondWindow = createMockMainWindow();
        (BrowserWindow as unknown as jest.Mock).mockReturnValue(secondWindow);

        App.ensureMainWindow();

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(secondWindow);
    });

    it('clears only service worker registrations and cache storage', async () => {
        await clearElectronServiceWorkerStorage();

        expect(mockClearStorageData).toHaveBeenCalledWith({
            storages: ['serviceworkers', 'cachestorage'],
        });
    });
});
