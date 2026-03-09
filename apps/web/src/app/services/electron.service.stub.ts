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

    removeAllListeners(_type: string): void {
        void _type;
        return undefined;
    }

    getAppVersion() {
        return this.remote.app.getVersion();
    }

    sendIpcEvent(_type: string, _payload?: unknown): void {
        void _type;
        void _payload;
        return undefined;
    }

    listenOn(
        _command: string,
        _callback: (...args: unknown[]) => void
    ): void {
        void _command;
        void _callback;
        return undefined;
    }

    getAppEnvironment() {
        return 'electron';
    }
}
