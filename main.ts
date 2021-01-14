/* eslint-disable no-useless-catch */
import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import * as url from 'url';
import { Api } from './api';
import { AppMenu } from './menu';

let win: BrowserWindow = null;
const args = process.argv.slice(1),
    serve = args.some((val) => val === '--serve');

const api = new Api();

function createWindow(): BrowserWindow {
    // Create the browser window.
    win = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            allowRunningInsecureContent: serve ? true : false,
            contextIsolation: false,
            enableRemoteModule: true,
        },
        resizable: true,
        darkTheme: true,
        icon: path.join(__dirname, 'dist/assets/icons/icon.png'),
        titleBarStyle: 'hidden',
        frame: false,
        minWidth: 900,
        minHeight: 700,
        title: 'IPTVnator',
    });

    if (serve) {
        win.webContents.openDevTools();

        require('electron-reload')(__dirname, {
            electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
        });
        win.loadURL('http://localhost:4200');
    } else {
        win.loadURL(
            url.format({
                pathname: path.join(__dirname, 'dist/index.html'),
                protocol: 'file:',
                slashes: true,
            })
        );
    }

    // Emitted when the window is closed.
    win.on('closed', () => {
        // Dereference the window object, usually you would store window
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        win = null;
    });

    return win;
}

/**
 * Creates hidden window for EPG worker
 * Hidden window is used as an additional thread to avoid blocking of the UI by long operations
 */
function createEpgWorkerWindow() {
    const window = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: true, enableRemoteModule: true },
    });

    if (serve) {
        window.loadFile('epg-worker.html');
        window.webContents.openDevTools();
    } else {
        window.loadFile('dist/epg-worker.html');
    }

    window.once('ready-to-show', () => {
        api.setEpgWorkerWindow(window);
    });

    return window;
}

try {
    app.allowRendererProcessReuse = true;

    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    // Added 400 ms to fix the black background issue while using transparent window. More details at https://github.com/electron/electron/issues/15947
    app.on('ready', () => {
        // create main window and set menu
        const win = createWindow();
        const menu = AppMenu.createMenu(win);
        Menu.setApplicationMenu(menu);
        api.setMainWindow(win);

        // create hidden window for epg worker
        createEpgWorkerWindow();
    });

    // Quit when all windows are closed.
    app.on('window-all-closed', () => {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('activate', () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (win === null) {
            createWindow();
        }
    });
} catch (e) {
    // Catch Error
    throw e;
}
