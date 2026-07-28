import {
    bootstrapRemoteControl as bootstrapRemoteControlWith,
    getIpcHandler,
    invokeHttpHandler,
    METHOD_NOT_ALLOWED_RESPONSE,
    mockFirstRendererSend,
    mockGetAllWindows,
    mockHttpHandlers,
    mockIpcHandle,
    mockIpcHandlers,
    mockIpcOn,
    mockRegisterRemoteControlHandler,
    mockSecondRendererSend,
    mockStartHttpServer,
    mockStoreGet,
    REMOTE_CONTROL_PATHS,
    resetRemoteControlMocks,
    SUCCESS_RESPONSE,
    type RemoteControlSettings,
} from './remote-control.test-helpers';

jest.mock('electron', () => ({
    BrowserWindow: {
        getAllWindows: mockGetAllWindows,
    },
    ipcMain: {
        handle: mockIpcHandle,
        on: mockIpcOn,
    },
}));

jest.mock('../server/http-server', () => ({
    httpServer: {
        registerRemoteControlHandler: mockRegisterRemoteControlHandler,
        start: mockStartHttpServer,
    },
}));

jest.mock('../services/store.service', () => ({
    store: {
        get: mockStoreGet,
    },
}));

import { RemoteControlEvents } from './remote-control.events';

const bootstrapRemoteControl = (settings?: RemoteControlSettings) =>
    bootstrapRemoteControlWith(RemoteControlEvents, settings);

describe('RemoteControlEvents bootstrap and dispatch', () => {
    let consoleLog: jest.SpyInstance;
    let consoleWarn: jest.SpyInstance;

    beforeEach(() => {
        resetRemoteControlMocks();
        consoleLog = jest
            .spyOn(console, 'log')
            .mockImplementation(() => undefined);
        consoleWarn = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
        consoleLog.mockRestore();
        consoleWarn.mockRestore();
    });

    it('registers exactly the seven remote-control HTTP endpoints', () => {
        bootstrapRemoteControl();

        expect(mockRegisterRemoteControlHandler).toHaveBeenCalledTimes(7);
        expect([...mockHttpHandlers.keys()].sort()).toEqual(
            Object.values(REMOTE_CONTROL_PATHS).sort()
        );
    });

    it('starts the HTTP server once with the stored port when enabled', () => {
        bootstrapRemoteControl({ enabled: true, port: 9987 });

        expect(mockStoreGet).toHaveBeenNthCalledWith(1, 'remoteControl', false);
        expect(mockStoreGet).toHaveBeenNthCalledWith(
            2,
            'remoteControlPort',
            8765
        );
        expect(mockStartHttpServer).toHaveBeenCalledTimes(1);
        expect(mockStartHttpServer).toHaveBeenCalledWith(9987);
    });

    it('does not start the HTTP server when remote control is disabled', () => {
        bootstrapRemoteControl({ enabled: false, port: 9987 });

        expect(mockStartHttpServer).not.toHaveBeenCalled();
    });

    it('registers and dispatches both main-app channel IPC handlers', () => {
        bootstrapRemoteControl();

        expect(mockIpcHandle).toHaveBeenCalledTimes(2);
        expect([...mockIpcHandlers.keys()].sort()).toEqual([
            'REMOTE_CONTROL_CHANNEL_DOWN',
            'REMOTE_CONTROL_CHANNEL_UP',
        ]);

        const ipcEventPlaceholder = {};
        expect(
            getIpcHandler('REMOTE_CONTROL_CHANNEL_UP')(ipcEventPlaceholder)
        ).toBeUndefined();
        expect(
            getIpcHandler('REMOTE_CONTROL_CHANNEL_DOWN')(ipcEventPlaceholder)
        ).toBeUndefined();

        expect(mockFirstRendererSend).toHaveBeenCalledTimes(2);
        expect(mockFirstRendererSend).toHaveBeenNthCalledWith(
            1,
            'CHANNEL_CHANGE',
            { direction: 'up' }
        );
        expect(mockFirstRendererSend).toHaveBeenNthCalledWith(
            2,
            'CHANNEL_CHANGE',
            { direction: 'down' }
        );
        expect(mockSecondRendererSend).not.toHaveBeenCalled();
    });

    it.each([
        {
            path: REMOTE_CONTROL_PATHS.CHANNEL_UP,
            channel: 'CHANNEL_CHANGE',
            payload: { direction: 'up' },
        },
        {
            path: REMOTE_CONTROL_PATHS.CHANNEL_DOWN,
            channel: 'CHANNEL_CHANGE',
            payload: { direction: 'down' },
        },
        {
            path: REMOTE_CONTROL_PATHS.VOLUME_UP,
            channel: 'REMOTE_CONTROL_COMMAND',
            payload: { type: 'volume-up' },
        },
        {
            path: REMOTE_CONTROL_PATHS.VOLUME_DOWN,
            channel: 'REMOTE_CONTROL_COMMAND',
            payload: { type: 'volume-down' },
        },
        {
            path: REMOTE_CONTROL_PATHS.VOLUME_TOGGLE_MUTE,
            channel: 'REMOTE_CONTROL_COMMAND',
            payload: { type: 'volume-toggle-mute' },
        },
    ] as const)(
        'dispatches POST $path to the first renderer',
        async ({ path, channel, payload }) => {
            bootstrapRemoteControl();

            const result = await invokeHttpHandler(path, { method: 'POST' });

            expect(result.response).toEqual(SUCCESS_RESPONSE);
            expect(mockFirstRendererSend).toHaveBeenCalledTimes(1);
            expect(mockFirstRendererSend).toHaveBeenCalledWith(
                channel,
                payload
            );
            expect(mockSecondRendererSend).not.toHaveBeenCalled();
        }
    );

    it.each([
        REMOTE_CONTROL_PATHS.SELECT_NUMBER,
        REMOTE_CONTROL_PATHS.CHANNEL_UP,
        REMOTE_CONTROL_PATHS.CHANNEL_DOWN,
        REMOTE_CONTROL_PATHS.VOLUME_UP,
        REMOTE_CONTROL_PATHS.VOLUME_DOWN,
        REMOTE_CONTROL_PATHS.VOLUME_TOGGLE_MUTE,
    ])('rejects GET on POST-only endpoint %s', async (path) => {
        bootstrapRemoteControl();

        const result = await invokeHttpHandler(path, { method: 'GET' });

        expect(result.response).toEqual(METHOD_NOT_ALLOWED_RESPONSE);
        expect(mockFirstRendererSend).not.toHaveBeenCalled();
        expect(mockSecondRendererSend).not.toHaveBeenCalled();
    });
});
