import { app, BrowserWindow, Menu, MenuItem, shell } from 'electron';
import * as path from 'path';
import {
    SHOW_WHATS_NEW,
    VIEW_ADD_PLAYLIST,
    VIEW_SETTINGS,
} from '../shared/ipc-commands';
const openAboutWindow = require('about-window').default;

export class AppMenu {
    /** Application menu */
    menu: Menu = new Menu();

    /** Application window */
    window: BrowserWindow;

    constructor(appWindow: BrowserWindow) {
        this.window = appWindow;
        this.initMenu();
    }

    /**
     * Creates context menu
     * @param win browser window object
     */
    initMenu(): void {
        this.menu.append(this.getFileMenu());

        // copy-paste shortcuts workaround for mac os
        if (process.platform === 'darwin') {
            this.menu.append(this.getEditMenu());
        }

        this.menu.append(this.getHelpMenu());
    }

    /**
     * Return the application menu
     */
    getMenu(): Menu {
        return this.menu;
    }

    /**
     * Creates and returns the file menu
     * @param win application window
     */
    private getFileMenu(): MenuItem {
        return new MenuItem({
            label: 'File',
            submenu: [
                {
                    label: 'Add playlist',
                    click: () =>
                        this.window.webContents.send(VIEW_ADD_PLAYLIST),
                },
                {
                    type: 'separator',
                },
                {
                    label: 'Settings',
                    click: () => this.window.webContents.send(VIEW_SETTINGS),
                },
                {
                    type: 'separator',
                },
                {
                    label: 'Exit',
                    click: () => app.quit(),
                },
            ],
        });
    }

    /**
     * Creates and returns the edit menu
     * @param win application window
     */
    private getHelpMenu(): MenuItem {
        return new MenuItem({
            label: 'Help',
            submenu: [
                {
                    label: 'What is new',
                    click: () => this.window.webContents.send(SHOW_WHATS_NEW),
                },
                {
                    label: 'Report a bug',
                    click: () =>
                        shell.openExternal(
                            'https://github.com/4gray/iptvnator'
                        ),
                },
                {
                    label: 'Buy me a coffee',
                    click: () =>
                        shell.openExternal(
                            'https://www.buymeacoffee.com/4gray'
                        ),
                },
                {
                    label: 'Open DevTools',
                    click: () => this.window.webContents.openDevTools(),
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
                            copyright: 'Copyright (c) 2020-2021 4gray',
                            package_json_dir: __dirname,
                        }),
                },
            ],
        });
    }

    /**
     * Creates and returns the help menu
     * @param win application window
     */
    private getEditMenu(): MenuItem {
        return new MenuItem({
            label: 'Edit',
            submenu: [
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
            ],
        });
    }
}
