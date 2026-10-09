const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('floatingPlayer', {
    onState: (callback) => {
        ipcRenderer.on('EMBEDDED_MPV_FLOATING_STATE', (_event, state) =>
            callback(state)
        );
    },
    pause: () => ipcRenderer.send('EMBEDDED_MPV_FLOATING_COMMAND', 'pause'),
    seek: (value) =>
        ipcRenderer.send('EMBEDDED_MPV_FLOATING_COMMAND', 'seek', value),
    seekBy: (value) =>
        ipcRenderer.send('EMBEDDED_MPV_FLOATING_COMMAND', 'seek-by', value),
    controlsFocus: (value) =>
        ipcRenderer.send(
            'EMBEDDED_MPV_FLOATING_COMMAND',
            'controls-focus',
            value
        ),
    minimize: () =>
        ipcRenderer.send('EMBEDDED_MPV_FLOATING_COMMAND', 'minimize'),
    drag: (phase) =>
        ipcRenderer.send('EMBEDDED_MPV_FLOATING_COMMAND', `drag-${phase}`),
    restore: () => ipcRenderer.send('EMBEDDED_MPV_FLOATING_COMMAND', 'restore'),
    volume: (value) =>
        ipcRenderer.send('EMBEDDED_MPV_FLOATING_COMMAND', 'volume', value),
});
