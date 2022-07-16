const customTitlebar = require('custom-electron-titlebar');
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    new customTitlebar.Titlebar({
        backgroundColor: customTitlebar.Color.fromHex('#000'),
        onMinimize: () => ipcRenderer.send('window-minimize'),
        onMaximize: () => ipcRenderer.send('window-maximize'),
        onClose: () => ipcRenderer.send('window-close'),
        isMaximized: () => ipcRenderer.sendSync('window-is-maximized'),
        onMenuItemClick: (commandId) =>
            ipcRenderer.send('menu-event', commandId),
    });
});
