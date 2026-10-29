import type { MenuItemConstructorOptions } from 'electron';
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { APP_MENU_ACTION } from '@iptvnator/shared/interfaces';
import { resolve } from 'node:path';
import {
    applicationMenuTemplate,
    installApplicationMenu,
    readMenuLabels,
} from './application-menu';

jest.mock('electron', () => ({
    app: { isPackaged: false, getLocale: jest.fn(() => 'en'), emit: jest.fn() },
    BrowserWindow: { fromWebContents: jest.fn() },
    ipcMain: { handle: jest.fn() },
    Menu: {
        buildFromTemplate: jest.fn((template) => template),
        setApplicationMenu: jest.fn(),
        getApplicationMenu: jest.fn(),
    },
}));

describe('application menu', () => {
    const labels = { settings: 'Settings…', updates: 'Check for Updates…' };
    it.each(['darwin', 'win32', 'linux'] as const)(
        'offers maintenance and standard roles on %s',
        (platform) => {
            const dispatch = jest.fn();
            const template = applicationMenuTemplate(
                platform,
                dispatch,
                labels
            );
            const children = template.flatMap((item) =>
                Array.isArray(item.submenu)
                    ? (item.submenu as MenuItemConstructorOptions[])
                    : []
            );
            const settings = children.find(
                (item) => item.id === 'app-settings'
            )!;
            const updates = children.find(
                (item) => item.id === 'app-check-for-updates'
            )!;
            expect(settings.accelerator).toBe('CommandOrControl+,');
            (settings.click as () => void)();
            (updates.click as () => void)();
            expect(dispatch.mock.calls).toEqual([
                ['settings'],
                ['check-for-updates'],
            ]);
            expect(template.map((item) => item.role)).toEqual(
                expect.arrayContaining([
                    'fileMenu',
                    'editMenu',
                    'viewMenu',
                    'windowMenu',
                ])
            );
            expect(template[0].label === 'IPTVnator').toBe(
                platform === 'darwin'
            );
        }
    );

    it('loads translated labels and safely falls back when assets are missing', () => {
        const directory = resolve('apps/web/src/assets/i18n');
        expect(readMenuLabels(directory, 'de-DE').settings).toBe(
            'Einstellungen…'
        );
        expect(readMenuLabels(directory, 'be-BY').settings).toBe('Налады…');
        expect(readMenuLabels(directory, 'ru').settings).toBe('Настройки…');
        expect(readMenuLabels(directory, 'ru').updates).toBe(
            'Проверить обновления…'
        );
        expect(readMenuLabels('/missing/translations', '../bad')).toEqual(
            labels
        );
    });

    it('queues a click until the preload has loaded and ignores a destroyed window', () => {
        let loaded!: () => void;
        let destroyed = false;
        const send = jest.fn();
        const window = {
            isDestroyed: () => destroyed,
            show: jest.fn(),
            focus: jest.fn(),
            webContents: {
                getURL: () => '',
                isLoadingMainFrame: () => true,
                send,
                on: jest.fn((_event, callback) => {
                    loaded = callback;
                }),
            },
        };
        installApplicationMenu(window as unknown as Electron.BrowserWindow);
        const template = (Menu.buildFromTemplate as jest.Mock).mock.calls.at(
            -1
        )[0] as MenuItemConstructorOptions[];
        const settings = template
            .flatMap((item) =>
                Array.isArray(item.submenu)
                    ? (item.submenu as MenuItemConstructorOptions[])
                    : []
            )
            .find((item) => item.id === 'app-settings')!;
        (settings.click as () => void)();
        expect(send).not.toHaveBeenCalled();
        loaded();
        expect(send).toHaveBeenCalledWith(APP_MENU_ACTION, 'settings');
        destroyed = true;
        (settings.click as () => void)();
        expect(send).toHaveBeenCalledTimes(1);
        expect(app.emit).toHaveBeenCalledWith('activate');
        destroyed = false;
        installApplicationMenu(window as unknown as Electron.BrowserWindow);
        loaded();
        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenLastCalledWith(APP_MENU_ACTION, 'settings');
        expect(Menu.setApplicationMenu).toHaveBeenCalled();
        expect(app.getLocale).toHaveBeenCalled();
    });
});

it('opens the fixed native menu only for a live sender window', () => {
    const popup = jest.fn();
    (Menu.getApplicationMenu as jest.Mock).mockReturnValue({ popup });
    const handler = (ipcMain.handle as jest.Mock).mock.calls.find(
        ([channel]) => channel === 'APP:MENU_OPEN'
    )[1];
    const window = { isDestroyed: () => false };
    (BrowserWindow.fromWebContents as jest.Mock).mockReturnValue(window);
    const sender = {};
    handler({ sender });
    expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(sender);
    expect(popup).toHaveBeenCalledWith({ window });
    (BrowserWindow.fromWebContents as jest.Mock).mockReturnValue(null);
    handler({ sender });
    (BrowserWindow.fromWebContents as jest.Mock).mockReturnValue({
        isDestroyed: () => true,
    });
    handler({ sender });
    expect(popup).toHaveBeenCalledTimes(1);
});
