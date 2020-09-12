import { app, BrowserWindow, Menu, MenuItem, shell } from 'electron';
import * as path from 'path';
import * as url from 'url';
import { Api } from './api';
const openAboutWindow = require('about-window').default;

let win: BrowserWindow = null;
const args = process.argv.slice(1),
    serve = args.some((val) => val === '--serve');

function createWindow(): BrowserWindow {
    // Create the browser window.
    win = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            allowRunningInsecureContent: serve ? true : false,
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
    const menu = createMenu(win);
    Menu.setApplicationMenu(menu);

    if (serve) {
        win.webContents.openDevTools();

        require('electron-reload')(__dirname, {
            electron: require(`${__dirname}/node_modules/electron`),
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
 * Creates context menu
 * @param win browser window object
 */
function createMenu(win: BrowserWindow) {
    const menu = new Menu();
    menu.append(
        new MenuItem({
            label: 'File',
            submenu: [
                {
                    label: 'Add playlist',
                    click: () => win.webContents.send('add-playlist-view'),
                },
                {
                    type: 'separator',
                },
                {
                    label: 'Exit',
                    click: () => app.quit(),
                },
            ],
        })
    );

    // copy-paste shortcuts workaround for mac os
    if (process.platform === 'darwin') {
        menu.append(
            new MenuItem({
                label: 'Edit',
                submenu: [
                    { role: 'cut' },
                    { role: 'copy' },
                    { role: 'paste' },
                    { role: 'delete' },
                ],
            })
        );
    }

    menu.append(
        new MenuItem({
            label: 'Help',
            submenu: [
                {
                    label: 'Report a bug',
                    click: () =>
                        shell.openExternal(
                            'https://github.com/4gray/my-iptv-player-pwa'
                        ),
                },
                {
                    label: 'Open DevTools',
                    click: () => win.webContents.openDevTools(),
                },
                {
                    type: 'separator',
                },
                {
                    label: 'About',
                    click: () =>
                        openAboutWindow({
                            icon_path: path.join(
                                __dirname,
                                'dist/assets/icons/icon.png'
                            ),
                            copyright: 'Copyright (c) 2020 4gray',
                            package_json_dir: __dirname,
                        }),
                },
            ],
        })
    );

    return menu;
}

try {
    app.allowRendererProcessReuse = true;

    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    // Added 400 ms to fix the black background issue while using transparent window. More details at https://github.com/electron/electron/issues/15947
    app.on('ready', () => setTimeout(createWindow, 400));

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

new Api();
