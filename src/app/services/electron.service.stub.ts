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
            getVersion: jest.fn(() => '1.0.0'),
        }
    };

    getAppVersion() {
        return this.remote.app.getVersion();
    }

    sendIpcEvent() { 
        this.ipcRenderer.send();
    }
}