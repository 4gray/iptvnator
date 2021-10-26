export class ElectronServiceStub {
    ipcRenderer = {
        send: jest.fn(),
        on: jest.fn(),
        removeAllListeners: jest.fn(),
    };
    remote = {
        process: {
            platform: 'linux',
            argv: [0, 1],
        },
        app: {
            getVersion: jest.fn(),
        }
    };

    getAppVersion() {
        this.remote.app.getVersion();
    }

    sendIpcEvent() { 
        this.ipcRenderer.send();
    }
}