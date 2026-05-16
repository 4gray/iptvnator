type EventHandler = (...args: unknown[]) => void;

function flushPromises(): Promise<void> {
    return Promise.resolve()
        .then(() => undefined)
        .then(() => undefined)
        .then(() => undefined)
        .then(() => undefined);
}

describe('Electron app startup', () => {
    afterEach(() => {
        jest.useRealTimers();
        jest.resetModules();
        jest.restoreAllMocks();
    });

    it('waits for the startup splash to load before preparing Proton VPN', async () => {
        const harness = await createAppHarness();

        harness.App.main(
            harness.mockElectronApp as never,
            harness.MockBrowserWindow as never
        );
        harness.appEvents.get('ready')?.();
        await flushPromises();

        expect(harness.splashShow).toHaveBeenCalledWith(
            expect.objectContaining({ phase: 'settings' })
        );
        expect(
            harness.protonVpnIntegration.prepareForAppLaunch
        ).not.toHaveBeenCalled();

        harness.resolveSplash();
        await flushPromises();

        expect(
            harness.protonVpnIntegration.prepareForAppLaunch
        ).toHaveBeenCalledTimes(1);
    });

    it('uses the saved app language for startup splash copy', async () => {
        const harness = await createAppHarness({
            storeValues: {
                APP_LANGUAGE: 'it',
            },
        });

        harness.resolveSplash();
        harness.App.main(
            harness.mockElectronApp as never,
            harness.MockBrowserWindow as never
        );
        harness.appEvents.get('ready')?.();
        await flushPromises();

        expect(harness.StartupSplashWindow).toHaveBeenCalledWith(
            harness.MockBrowserWindow,
            'it'
        );
        expect(harness.splashShow).toHaveBeenCalledWith(
            expect.objectContaining({
                detail: expect.stringContaining('impostazioni locali'),
                status: 'Preparazione avvio',
            })
        );
    });

    it('keeps the main window hidden until the renderer reports its first meaningful frame', async () => {
        const harness = await createAppHarness();

        harness.resolveSplash();
        harness.App.main(
            harness.mockElectronApp as never,
            harness.MockBrowserWindow as never
        );
        harness.appEvents.get('ready')?.();
        await flushPromises();

        const mainWindow = harness.browserWindows[0];
        expect(mainWindow).toBeDefined();

        mainWindow.emit('ready-to-show');
        expect(mainWindow.show).not.toHaveBeenCalled();
        expect(harness.splashClose).not.toHaveBeenCalled();

        harness.ipcHandlers.get('APP_RENDERER_READY')?.({
            sender: mainWindow.webContents,
        });

        expect(mainWindow.show).toHaveBeenCalledTimes(1);
        expect(harness.splashClose).toHaveBeenCalledTimes(1);
    });
});

async function createAppHarness(
    options: { storeValues?: Record<string, unknown> } = {}
) {
    jest.resetModules();
    jest.useFakeTimers();

    const appEvents = new Map<string, EventHandler>();
    const ipcHandlers = new Map<string, EventHandler>();
    const browserWindows: MockBrowserWindow[] = [];
    let resolveSplash!: () => void;
    const splashLoaded = new Promise<void>((resolve) => {
        resolveSplash = resolve;
    });
    const splashShow = jest.fn(() => splashLoaded);
    const splashUpdate = jest.fn();
    const splashClose = jest.fn();
    const StartupSplashWindow = jest.fn().mockImplementation(() => ({
        close: splashClose,
        show: splashShow,
        update: splashUpdate,
    }));

    class MockBrowserWindow {
        readonly events = new Map<string, EventHandler>();
        readonly webContentsEvents = new Map<string, EventHandler>();
        readonly show = jest.fn();
        readonly close = jest.fn();
        readonly center = jest.fn();
        readonly setMenu = jest.fn();
        readonly isDestroyed = jest.fn(() => false);
        readonly getNormalBounds = jest.fn(() => ({
            height: 720,
            width: 1280,
            x: 0,
            y: 0,
        }));
        readonly loadURL = jest.fn(() => Promise.resolve());
        readonly loadFile = jest.fn(() => Promise.resolve());
        readonly webContents = {
            getURL: jest.fn(() => 'http://localhost:4200'),
            loadURL: this.loadURL,
            loadFile: this.loadFile,
            on: jest.fn((event: string, handler: EventHandler) => {
                this.webContentsEvents.set(event, handler);
            }),
            once: jest.fn((event: string, handler: EventHandler) => {
                this.webContentsEvents.set(event, handler);
            }),
            openDevTools: jest.fn(),
            setWindowOpenHandler: jest.fn(),
        };

        constructor() {
            browserWindows.push(this);
        }

        on(event: string, handler: EventHandler): void {
            this.events.set(event, handler);
        }

        once(event: string, handler: EventHandler): void {
            this.events.set(event, handler);
        }

        emit(event: string, ...args: unknown[]): void {
            this.events.get(event)?.(...args);
        }
    }

    const mockElectronApp = {
        getLocale: jest.fn(() => 'en-US'),
        isPackaged: false,
        on: jest.fn((event: string, handler: EventHandler) => {
            appEvents.set(event, handler);
        }),
        quit: jest.fn(),
    };
    const protonVpnIntegration = {
        prepareForAppLaunch: jest.fn().mockResolvedValue({
            location: 'HR',
            status: 'disabled',
        }),
        restoreAfterAppExit: jest.fn(),
    };

    jest.doMock('electron', () => ({
        app: mockElectronApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: {
            off: jest.fn((channel: string, handler: EventHandler) => {
                if (ipcHandlers.get(channel) === handler) {
                    ipcHandlers.delete(channel);
                }
            }),
            on: jest.fn((channel: string, handler: EventHandler) => {
                ipcHandlers.set(channel, handler);
            }),
        },
        Menu: {
            buildFromTemplate: jest.fn(() => ({ popup: jest.fn() })),
        },
        screen: {
            getPrimaryDisplay: jest.fn(() => ({
                workAreaSize: { height: 900, width: 1400 },
            })),
        },
        shell: {
            openExternal: jest.fn(),
        },
    }));
    jest.doMock('./services/debug-trace', () => ({
        isRendererConsoleTraceEnabled: jest.fn(() => false),
        isWindowTraceEnabled: jest.fn(() => false),
        trace: jest.fn(),
    }));
    jest.doMock('./services/launcher-vpn-session.service', () => ({
        launcherVpnSession: {
            restoreAfterAppExit: jest.fn(),
        },
    }));
    jest.doMock('./services/media-metadata-background-warmup.service', () => ({
        mediaMetadataBackgroundWarmup: {
            shouldKeepAppAlive: jest.fn(() => false),
        },
    }));
    jest.doMock('./services/proton-vpn-integration.service', () => ({
        protonVpnIntegration,
    }));
    jest.doMock('./services/startup-splash-window.service', () => ({
        ...jest.requireActual('./services/startup-splash-window.service'),
        StartupSplashWindow,
    }));
    jest.doMock('./services/store.service', () => ({
        store: {
            get: jest.fn((key: string, defaultValue?: unknown) =>
                Object.prototype.hasOwnProperty.call(
                    options.storeValues ?? {},
                    key
                )
                    ? options.storeValues?.[key]
                    : defaultValue
            ),
            set: jest.fn(),
        },
        APP_LANGUAGE: 'APP_LANGUAGE',
        VPN_RESTORE_ON_EXIT: 'vpnRestoreOnExit',
        WINDOW_BOUNDS: 'windowBounds',
    }));

    const { default: App } = await import('./app');

    return {
        App,
        MockBrowserWindow,
        appEvents,
        browserWindows,
        ipcHandlers,
        mockElectronApp,
        protonVpnIntegration,
        resolveSplash,
        splashClose,
        splashShow,
        splashUpdate,
        StartupSplashWindow,
    };
}
