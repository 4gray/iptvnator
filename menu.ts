import { app, BrowserWindow, Menu, MenuItem, shell } from 'electron';
import * as path from 'path';
const openAboutWindow = require('about-window').default;

export class AppMenu {
    /**
     * Creates context menu
     * @param win browser window object
     */
    static createMenu(win: BrowserWindow): Menu {
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
                                'https://github.com/4gray/iptvnator'
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
}
