const mockClearStorageData = jest.fn();

jest.mock('electron', () => ({
    app: {
        getPath: jest.fn(() => '/tmp'),
        isPackaged: false,
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
import { app as electronApp } from 'electron';

type MockMainWindow = {
    loadFile: jest.Mock<Promise<void>, [string]>;
    loadURL: jest.Mock<Promise<void>, [string]>;
    webContents: {
        openDevTools: jest.Mock<void, []>;
    };
};

function createMockMainWindow(): MockMainWindow {
    return {
        loadFile: jest.fn<Promise<void>, [string]>().mockResolvedValue(),
        loadURL: jest.fn<Promise<void>, [string]>().mockResolvedValue(),
        webContents: {
            openDevTools: jest.fn<void, []>(),
        },
    };
}

type AppInternals = {
    mainWindow: MockMainWindow;
    loadMainWindow: () => Promise<void>;
};

function getAppInternals(): AppInternals {
    return App as unknown as AppInternals;
}

describe('Electron app security helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.ELECTRON_IS_DEV;
        (electronApp as unknown as { isPackaged: boolean }).isPackaged = false;
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

    it('clears only service worker registrations and cache storage', async () => {
        await clearElectronServiceWorkerStorage();

        expect(mockClearStorageData).toHaveBeenCalledWith({
            storages: ['serviceworkers', 'cachestorage'],
        });
    });
});
