import { BrowserWindow, Menu, screen, shell } from 'electron';
import { join } from 'path';
import { environment } from '../environments/environment';
import { rendererAppName, rendererAppPort } from './constants';
import { store, WINDOW_BOUNDS } from './services/store.service';

export default class App {
    // Keep a global reference of the window object, if you don't, the window will
    // be closed automatically when the JavaScript object is garbage collected.
    static mainWindow: Electron.BrowserWindow;
    static application: Electron.App;
    static BrowserWindow;

    public static isDevelopmentMode() {
        const isEnvironmentSet: boolean = 'ELECTRON_IS_DEV' in process.env;
        const getFromEnvironment: boolean =
            parseInt(process.env.ELECTRON_IS_DEV, 10) === 1;

        return isEnvironmentSet ? getFromEnvironment : !environment.production;
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

    private static onReady() {
        // This method will be called when Electron has finished
        // initialization and is ready to create browser windows.
        // Some APIs can only be used after this event occurs.
        if (rendererAppName) {
            App.initMainWindow();
            App.loadMainWindow();
        }
    }

    private static onActivate() {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (App.mainWindow === null) {
            App.onReady();
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

    private static loadMainWindow() {
        // load the index.html of the app.
        if (!App.application.isPackaged) {
            App.mainWindow.loadURL(`http://localhost:${rendererAppPort}`);
            App.mainWindow.webContents.openDevTools();
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
        App.application.on('ready', App.onReady); // App is ready to load data
        App.application.on('activate', App.onActivate); // App is activated
        App.application.on('before-quit', () => {
            if (App.mainWindow)
                store.set(WINDOW_BOUNDS, App.mainWindow.getNormalBounds());
        });
    }
}
