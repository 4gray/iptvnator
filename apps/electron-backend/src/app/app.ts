import { app, BrowserWindow, Menu, screen, shell } from 'electron';
import * as http from 'node:http';
import { join } from 'path';
import { rendererAppName, rendererAppPort } from './constants';
import { store, WINDOW_BOUNDS } from './services/store.service';

export default class App {
    // Keep a global reference of the window object, if you don't, the window will
    // be closed automatically when the JavaScript object is garbage collected.
    static mainWindow: Electron.BrowserWindow;
    static application: Electron.App;
    static BrowserWindow;

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

    private static getDevServerUrl() {
        return `http://localhost:${rendererAppPort}/workspace/dashboard`;
    }

    private static wait(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private static async isDevServerReachable(url: string): Promise<boolean> {
        return await new Promise((resolve) => {
            const req = http.get(url, (res) => {
                res.resume();
                resolve(true);
            });

            req.on('error', () => resolve(false));

            req.setTimeout(1500, () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    private static async waitForDevServer(
        url: string,
        maxAttempts = 30,
        delayMs = 1000
    ): Promise<boolean> {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const reachable = await App.isDevServerReachable(url);

            if (reachable) {
                return true;
            }

            await App.wait(delayMs);
        }

        return false;
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

    private static onRedirect(event: any, url: string) {
        if (url !== App.mainWindow.webContents.getURL()) {
            // this is a normal external redirect, open it in a new browser window
            event.preventDefault();
            shell.openExternal(url);
        }
    }

    private static async onReady() {
        // This method will be called when Electron has finished
        // initialization and is ready to create browser windows.
        // Some APIs can only be used after this event occurs.
        if (rendererAppName) {
            App.initMainWindow();
            await App.loadMainWindow();
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
        if (!savedWindowBounds) {
            App.mainWindow.center();
        }

        // if main window is ready to show, close the splash window and show the main window
        App.mainWindow.once('ready-to-show', () => {
            App.mainWindow.show();
        });

        // Retry dev page load if the renderer wasn't ready yet
        App.mainWindow.webContents.on(
            'did-fail-load',
            async (_event, _errorCode, _errorDescription, validatedURL, isMainFrame) => {
                if (
                    App.isDevelopmentMode() &&
                    isMainFrame &&
                    validatedURL === App.getDevServerUrl()
                ) {
                    const reachable = await App.waitForDevServer(App.getDevServerUrl(), 10, 1000);

                    if (reachable && App.mainWindow && !App.mainWindow.isDestroyed()) {
                        await App.mainWindow.loadURL(App.getDevServerUrl());
                    }
                }
            }
        );

        // handle all external redirects in a new browser window
        // App.mainWindow.webContents.on('will-navigate', App.onRedirect);
        // App.mainWindow.webContents.on('new-window', (event, url, frameName, disposition, options) => {
        //     App.onRedirect(event, url);
        // });

        // Emitted when the window is closed.
        App.mainWindow.on('closed', () => {
            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
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

    private static async loadMainWindow() {
        // load the index.html of the app.
        if (App.isDevelopmentMode()) {
            const devServerUrl = App.getDevServerUrl();
            await App.waitForDevServer(devServerUrl);
            await App.mainWindow.loadURL(devServerUrl);
            App.mainWindow.webContents.openDevTools();
        } else {
            await App.mainWindow.loadFile(
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
        App.application.on('ready', () => {
            void App.onReady();
        }); // App is ready to load data
        App.application.on('activate', App.onActivate); // App is activated
        App.application.on('before-quit', () => {
            if (App.mainWindow)
                store.set(WINDOW_BOUNDS, App.mainWindow.getNormalBounds());
        });
    }
}