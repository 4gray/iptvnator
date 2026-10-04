const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('floatingPlayer', {
    onState: (callback) => {
        ipcRenderer.on('EMBEDDED_MPV_FLOATING_STATE', (_event, state) =>
            callback(state)
        );
    },
    pause: () => ipcRenderer.send('EMBEDDED_MPV_FLOATING_COMMAND', 'pause'),
    restore: () => ipcRenderer.send('EMBEDDED_MPV_FLOATING_COMMAND', 'restore'),
    volume: (value) =>
        ipcRenderer.send('EMBEDDED_MPV_FLOATING_COMMAND', 'volume', value),
});
