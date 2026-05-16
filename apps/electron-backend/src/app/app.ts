import { app, BrowserWindow, ipcMain, Menu, screen, shell } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { APP_RENDERER_READY_CHANNEL } from './api/renderer-ready.channel';
import { rendererAppName, rendererAppPort } from './constants';
import {
    isRendererConsoleTraceEnabled,
    isWindowTraceEnabled,
    trace,
} from './services/debug-trace';
import { launcherVpnSession } from './services/launcher-vpn-session.service';
import { mediaMetadataBackgroundWarmup } from './services/media-metadata-background-warmup.service';
import { protonVpnIntegration } from './services/proton-vpn-integration.service';
import {
    createStartupSplashUpdate,
    normalizeStartupSplashLanguage,
    StartupSplashUpdate,
    StartupSplashWindow,
} from './services/startup-splash-window.service';
import {
    APP_LANGUAGE,
    store,
    VPN_RESTORE_ON_EXIT,
    WINDOW_BOUNDS,
} from './services/store.service';

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
    static mainWindow: Electron.BrowserWindow;
    static application: Electron.App;
    static BrowserWindow;
    private static startupSplashWindow: StartupSplashWindow | null = null;
    private static mainWindowReadyToShow = false;
    private static rendererReady = false;
    private static rendererReadyHandler:
        | ((event: Electron.IpcMainEvent) => void)
        | null = null;
    private static rendererReadyTimeout: NodeJS.Timeout | null = null;

    private static shouldOpenDevTools() {
        return process.env.ELECTRON_OPEN_DEVTOOLS === '1';
    }

    private static hasBundledRendererBuild() {
        return existsSync(join(__dirname, '..', rendererAppName, 'index.html'));
    }

    public static isDevelopmentMode() {
        // First check ELECTRON_IS_DEV environment variable (used by E2E tests)
        // This allows E2E tests to run in production mode without packaging
        if ('ELECTRON_IS_DEV' in process.env) {
            return parseInt(process.env.ELECTRON_IS_DEV, 10) === 1;
        }
        // When launching the already-built dist app through the repo's local
        // Electron binary, app.isPackaged is still false. In that case load the
        // bundled renderer instead of trying localhost:4200.
        if (App.hasBundledRendererBuild()) {
            return false;
        }
        // Fall back to Electron's built-in app.isPackaged
        // This is the most reliable way to detect if the app is packaged
        return !app.isPackaged;
    }

    public static isMetadataWarmupMode(): boolean {
        return process.argv.includes('--metadata-warmup');
    }

    private static onWindowAllClosed() {
        if (process.platform !== 'darwin') {
            if (mediaMetadataBackgroundWarmup.shouldKeepAppAlive()) {
                return;
            }

            App.application.quit();
        }
    }

    private static onClose() {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        App.mainWindow = null;
    }

    private static onRedirect(event: any, url: string) {
        if (url !== App.mainWindow.webContents.getURL()) {
            // this is a normal external redirect, open it in a new browser window
            event.preventDefault();
            shell.openExternal(url);
        }
    }

    static updateStartupSplash(update: StartupSplashUpdate): void {
        App.startupSplashWindow?.update(update);
    }

    private static getStartupSplashLanguage() {
        const savedLanguage = store.get(APP_LANGUAGE, '');
        if (savedLanguage) {
            return normalizeStartupSplashLanguage(savedLanguage);
        }

        return normalizeStartupSplashLanguage(
            App.application?.getLocale?.().slice(0, 2)
        );
    }

    public static startupSplashUpdate(
        phase: StartupSplashUpdate['phase'],
        progress?: number,
        override: Partial<Pick<StartupSplashUpdate, 'status' | 'detail'>> = {}
    ): StartupSplashUpdate {
        return createStartupSplashUpdate(
            App.getStartupSplashLanguage(),
            phase,
            progress,
            override
        );
    }

    private static async showStartupSplash(
        update: StartupSplashUpdate
    ): Promise<void> {
        if (!App.startupSplashWindow) {
            App.startupSplashWindow = new StartupSplashWindow(
                App.BrowserWindow,
                App.getStartupSplashLanguage()
            );
        }

        await App.startupSplashWindow.show(update);
    }

    private static closeStartupSplash(): void {
        App.startupSplashWindow?.close();
        App.startupSplashWindow = null;
    }

    private static async onReady() {
        // This method will be called when Electron has finished
        // initialization and is ready to create browser windows.
        // Some APIs can only be used after this event occurs.
        if (App.isMetadataWarmupMode()) {
            return;
        }

        if (rendererAppName) {
            await App.showStartupSplash(App.startupSplashUpdate('settings', 8));

            try {
                App.updateStartupSplash(App.startupSplashUpdate('vpn', 28));
                await protonVpnIntegration.prepareForAppLaunch();
            } catch (error) {
                console.warn(
                    'Failed to prepare Proton VPN integration.',
                    error
                );
                App.updateStartupSplash(
                    App.startupSplashUpdate('error', 36, {
                        status:
                            App.getStartupSplashLanguage() === 'it'
                                ? 'VPN non pronta'
                                : 'VPN not ready',
                        detail:
                            App.getStartupSplashLanguage() === 'it'
                                ? "La preparazione VPN non ha risposto correttamente. Continuo ad aprire l'app e potrai controllare lo stato dalle impostazioni."
                                : 'VPN preparation did not respond correctly. The app will continue opening and you can check the status from settings.',
                    })
                );
            }

            App.updateStartupSplash(App.startupSplashUpdate('window', 56));
            App.initMainWindow();
            App.updateStartupSplash(App.startupSplashUpdate('metadata', 74));
            App.loadMainWindow();
        }
    }

    private static onActivate() {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (App.mainWindow === null) {
            void App.onReady();
        }
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
            webPreferences: {
                contextIsolation: true,
                backgroundThrottling: false,
                preload: join(__dirname, 'main.preload.js'),
            },
            ...savedWindowBounds,
            minHeight: 600,
            minWidth: 900,
            ...(process.platform === 'darwin'
                ? {
                      titleBarStyle: 'hidden',
                      titleBarOverlay: true,
                      trafficLightPosition: { x: 16, y: 20 },
                  }
                : {}),
        });
        App.mainWindow.setMenu(null);
        attachWindowTrace(App.mainWindow);
        if (!savedWindowBounds) {
            App.mainWindow.center();
        }

        App.installRendererReadyListener();

        // ready-to-show only means Chromium can paint; Angular may still be
        // resolving the initial route. Keep the splash until the renderer
        // explicitly reports its first meaningful frame.
        App.mainWindow.once('ready-to-show', () => {
            App.updateStartupSplash(
                App.startupSplashUpdate('window', 92, {
                    status:
                        App.getStartupSplashLanguage() === 'it'
                            ? 'Interfaccia caricata'
                            : 'Interface loaded',
                    detail:
                        App.getStartupSplashLanguage() === 'it'
                            ? 'Attendo il primo rendering completo prima di mostrare la finestra principale.'
                            : 'Waiting for the first complete render before showing the main window.',
                })
            );
            App.mainWindowReadyToShow = true;
            App.tryShowMainWindow();
        });

        App.mainWindow.webContents.once(
            'did-fail-load',
            (_event, _errorCode, errorDescription) => {
                App.clearRendererReadyListener();
                App.updateStartupSplash(
                    App.startupSplashUpdate('error', 100, {
                        status:
                            App.getStartupSplashLanguage() === 'it'
                                ? 'Problema nel caricamento'
                                : 'Loading problem',
                        detail:
                            errorDescription ||
                            (App.getStartupSplashLanguage() === 'it'
                                ? "Non riesco a caricare subito l'interfaccia principale."
                                : 'The main interface could not be loaded immediately.'),
                    })
                );
            }
        );

        App.mainWindow.webContents.once('render-process-gone', () => {
            App.clearRendererReadyListener();
            App.updateStartupSplash(
                App.startupSplashUpdate('error', 100, {
                    status:
                        App.getStartupSplashLanguage() === 'it'
                            ? 'Interfaccia non disponibile'
                            : 'Interface unavailable',
                    detail:
                        App.getStartupSplashLanguage() === 'it'
                            ? "Il processo dell'interfaccia si è chiuso prima del primo rendering. Riavvia l'app o apri DevTools per leggere l'errore."
                            : 'The interface process exited before the first render. Restart the app or open DevTools to read the error.',
                })
            );
        });

        // Route target="_blank" / window.open() to the OS default browser
        App.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (/^https?:\/\//.test(url)) {
                shell.openExternal(url);
            }
            return { action: 'deny' };
        });

        // Emitted when the window is closed.
        App.mainWindow.on('closed', () => {
            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
            App.clearRendererReadyListener();
            App.closeStartupSplash();
            App.mainWindow = null;
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

    private static installRendererReadyListener(): void {
        App.clearRendererReadyListener();
        App.mainWindowReadyToShow = false;
        App.rendererReady = false;

        const targetWindow = App.mainWindow;

        App.rendererReadyHandler = (event) => {
            if (
                !targetWindow ||
                targetWindow.isDestroyed() ||
                event.sender !== targetWindow.webContents
            ) {
                return;
            }

            App.rendererReady = true;
            App.tryShowMainWindow();
        };

        ipcMain.on(APP_RENDERER_READY_CHANNEL, App.rendererReadyHandler);
        App.rendererReadyTimeout = setTimeout(() => {
            if (
                App.rendererReady ||
                !App.mainWindow ||
                App.mainWindow.isDestroyed()
            ) {
                return;
            }

            App.updateStartupSplash(
                App.startupSplashUpdate('error', 100, {
                    status:
                        App.getStartupSplashLanguage() === 'it'
                            ? 'Interfaccia ancora in caricamento'
                            : 'Interface still loading',
                    detail:
                        App.getStartupSplashLanguage() === 'it'
                            ? "L'app non ha ancora completato il primo rendering. Tengo visibile questa schermata invece di mostrare una finestra bianca."
                            : 'The app has not completed its first render yet. This screen stays visible instead of showing a blank window.',
                })
            );
        }, 30000);
    }

    private static tryShowMainWindow(): void {
        if (
            !App.mainWindow ||
            App.mainWindow.isDestroyed() ||
            !App.mainWindowReadyToShow ||
            !App.rendererReady
        ) {
            return;
        }

        App.updateStartupSplash(App.startupSplashUpdate('ready', 100));
        App.closeStartupSplash();
        App.mainWindow.show();
        App.clearRendererReadyListener();
    }

    private static clearRendererReadyListener(): void {
        if (App.rendererReadyHandler) {
            ipcMain.off(APP_RENDERER_READY_CHANNEL, App.rendererReadyHandler);
            App.rendererReadyHandler = null;
        }

        if (App.rendererReadyTimeout) {
            clearTimeout(App.rendererReadyTimeout);
            App.rendererReadyTimeout = null;
        }
    }

    private static loadMainWindow() {
        // load the index.html of the app.
        if (App.isDevelopmentMode()) {
            App.mainWindow.loadURL(`http://localhost:${rendererAppPort}`);
            if (App.shouldOpenDevTools()) {
                App.mainWindow.webContents.openDevTools();
            }
        } else {
            App.mainWindow.loadFile(
                join(__dirname, '..', rendererAppName, 'index.html')
            );
        }
    }

    static main(app: Electron.App, browserWindow: typeof BrowserWindow) {
        // we pass the Electron.App object and the
        // Electron.BrowserWindow into this function
        // so this class has no dependencies. This
        // makes the code easier to write tests for

        App.BrowserWindow = browserWindow;
        App.application = app;

        App.application.on('window-all-closed', App.onWindowAllClosed); // Quit when all windows are closed.
        App.application.on('ready', () => void App.onReady()); // App is ready to load data
        App.application.on('activate', App.onActivate); // App is activated
        App.application.on('before-quit', () => {
            if (App.mainWindow)
                store.set(WINDOW_BOUNDS, App.mainWindow.getNormalBounds());
            if (store.get(VPN_RESTORE_ON_EXIT, true)) {
                launcherVpnSession.restoreAfterAppExit();
                protonVpnIntegration.restoreAfterAppExit();
            }
        });
    }
}
