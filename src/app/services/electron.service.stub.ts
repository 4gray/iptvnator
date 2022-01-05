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
        },
    };

    isElectron = true;

    removeAllListeners(type: string) {}

    getAppVersion() {
        return this.remote.app.getVersion();
    }

    sendIpcEvent() {}

    listenOn() {}
}
