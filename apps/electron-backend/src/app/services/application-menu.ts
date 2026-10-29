import {
    app,
    Menu,
    type BrowserWindow,
    type MenuItemConstructorOptions,
} from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    APP_MENU_ACTION,
    normalizeAppLanguage,
    type ElectronBridgeAppMenuAction,
} from '@iptvnator/shared/interfaces';

interface MenuLabels {
    settings: string;
    updates: string;
}

export function readMenuLabels(directory: string, locale: string): MenuLabels {
    try {
        const code = locale.toLowerCase().replace('_', '-');
        const language = normalizeAppLanguage(
            code === 'zh-tw' || code === 'zh-hk'
                ? 'zhtw'
                : code.startsWith('pt')
                  ? code
                  : code.split('-')[0]
        );
        const strings = JSON.parse(
            readFileSync(join(directory, `${language}.json`), 'utf8')
        );
        if (
            typeof strings.SETTINGS?.TITLE === 'string' &&
            typeof strings.STARTUP?.CHECK_UPDATES === 'string'
        ) {
            return {
                settings: `${strings.SETTINGS.TITLE}…`,
                updates: `${strings.STARTUP.CHECK_UPDATES}…`,
            };
        }
    } catch {
        /* The native menu must remain usable if language assets are missing. */
    }
    return { settings: 'Settings…', updates: 'Check for Updates…' };
}

export function applicationMenuTemplate(
    platform: NodeJS.Platform,
    dispatch: (action: ElectronBridgeAppMenuAction) => void,
    labels: MenuLabels
): MenuItemConstructorOptions[] {
    const settings: MenuItemConstructorOptions = {
        id: 'app-settings',
        label: labels.settings,
        accelerator: 'CommandOrControl+,',
        click: () => dispatch('settings'),
    };
    const updates: MenuItemConstructorOptions = {
        id: 'app-check-for-updates',
        label: labels.updates,
        click: () => dispatch('check-for-updates'),
    };
    const mac = platform === 'darwin';
    return [
        ...(mac
            ? [
                  {
                      label: 'IPTVnator',
                      submenu: [
                          { role: 'about' },
                          { type: 'separator' },
                          settings,
                          updates,
                          { type: 'separator' },
                          { role: 'services' },
                          { type: 'separator' },
                          { role: 'hide' },
                          { role: 'hideOthers' },
                          { role: 'unhide' },
                          { type: 'separator' },
                          { role: 'quit' },
                      ],
                  } as MenuItemConstructorOptions,
              ]
            : []),
        { role: 'fileMenu' },
        {
            role: 'editMenu',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
                ...(!mac
                    ? ([
                          { type: 'separator' },
                          settings,
                      ] as MenuItemConstructorOptions[])
                    : []),
            ],
        },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
        ...(!mac
            ? [
                  {
                      role: 'help',
                      submenu: [updates],
                  } as MenuItemConstructorOptions,
              ]
            : []),
    ];
}

let pendingWindowAction: ElectronBridgeAppMenuAction | null = null;

export function installApplicationMenu(window: BrowserWindow): void {
    const directory = app.isPackaged
        ? join(app.getAppPath(), 'web/assets/i18n')
        : join(process.cwd(), 'apps/web/src/assets/i18n');
    let pending = pendingWindowAction;
    pendingWindowAction = null;
    const send = (action: ElectronBridgeAppMenuAction) => {
        if (window.isDestroyed()) return;
        window.show();
        window.focus();
        window.webContents.send(APP_MENU_ACTION, action);
    };
    window.webContents.on('did-finish-load', () => {
        if (pending) {
            const action = pending;
            pending = null;
            send(action);
        }
    });
    const template = applicationMenuTemplate(
        process.platform,
        (action) => {
            if (window.isDestroyed()) {
                pendingWindowAction = action;
                app.emit('activate');
                return;
            }
            if (
                !window.webContents.getURL() ||
                window.webContents.isLoadingMainFrame()
            )
                pending = action;
            else send(action);
        },
        readMenuLabels(directory, app.getLocale())
    );
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
