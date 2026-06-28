const mockClearStorageData = jest.fn();

jest.mock('electron', () => ({
    app: {
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
    WINDOW_BOUNDS: 'windowBounds',
}));

import {
    clearElectronServiceWorkerStorage,
    getMainWindowWebPreferences,
    isExternalBrowserUrl,
    isTrustedRendererNavigationUrl,
} from './app';
import App from './app';
import { app as electronApp, BrowserWindow, screen } from 'electron';
import { store } from './services/store.service';

type MockMainWindow = {
    center: jest.Mock<void, []>;
    getNormalBounds: jest.Mock<object, []>;
    loadFile: jest.Mock<Promise<void>, [string]>;
    loadURL: jest.Mock<Promise<void>, [string]>;
    on: jest.Mock<void, [string, (...args: unknown[]) => void]>;
    once: jest.Mock<void, [string, (...args: unknown[]) => void]>;
    setMenu: jest.Mock<void, [unknown]>;
    show: jest.Mock<void, []>;
    webContents: {
        on: jest.Mock<void, [string, (...args: unknown[]) => void]>;
        openDevTools: jest.Mock<void, []>;
        setWindowOpenHandler: jest.Mock<void, [unknown]>;
    };
};

function createMockMainWindow(): MockMainWindow {
    return {
        center: jest.fn<void, []>(),
        getNormalBounds: jest.fn<object, []>().mockReturnValue({}),
        loadFile: jest.fn<Promise<void>, [string]>().mockResolvedValue(),
        loadURL: jest.fn<Promise<void>, [string]>().mockResolvedValue(),
        on: jest.fn<void, [string, (...args: unknown[]) => void]>(),
        once: jest.fn<void, [string, (...args: unknown[]) => void]>(),
        setMenu: jest.fn<void, [unknown]>(),
        show: jest.fn<void, []>(),
        webContents: {
            on: jest.fn<void, [string, (...args: unknown[]) => void]>(),
            openDevTools: jest.fn<void, []>(),
            setWindowOpenHandler: jest.fn<void, [unknown]>(),
        },
    };
}

type AppInternals = {
    loadedMainWindow: MockMainWindow | null;
    mainWindow: MockMainWindow | null;
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
        const appInternals = getAppInternals();
        appInternals.loadedMainWindow = null;
        appInternals.mainWindow = null;
        appInternals.mainWindowLoadPromise = null;
        appInternals.rendererLoadingEnabled = false;
        (electronApp as unknown as { isPackaged: boolean }).isPackaged = false;
        (screen.getPrimaryDisplay as jest.Mock).mockReturnValue({
            workAreaSize: { height: 720, width: 1280 },
        });
        (store.get as jest.Mock).mockReturnValue(undefined);
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
        expect(
            isTrustedRendererNavigationUrl(
                'file:///tmp/iptvnator/index.html',
                false,
                '/tmp/iptvnator/index.html'
            )
        ).toBe(true);
        expect(
            isTrustedRendererNavigationUrl(
                'file:///tmp/other/index.html',
                false,
                '/tmp/iptvnator/index.html'
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
        expect(
            mockClearStorageData.mock.invocationCallOrder[0]
        ).toBeLessThan(mainWindow.loadFile.mock.invocationCallOrder[0]);
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

    it('clears only service worker registrations and cache storage', async () => {
        await clearElectronServiceWorkerStorage();

        expect(mockClearStorageData).toHaveBeenCalledWith({
            storages: ['serviceworkers', 'cachestorage'],
        });
    });
});
