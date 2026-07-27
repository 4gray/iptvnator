import {
    bootstrapRemoteControl as bootstrapRemoteControlWith,
    createBodyAtByteLength,
    getIpcListener,
    invokeHttpHandler,
    JSON_HEADERS,
    METHOD_NOT_ALLOWED_RESPONSE,
    mockFirstRendererSend,
    mockGetAllWindows,
    mockIpcHandle,
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

describe('RemoteControlEvents HTTP endpoints', () => {
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

    it('rejects POST on the status endpoint', async () => {
        bootstrapRemoteControl();

        const result = await invokeHttpHandler(REMOTE_CONTROL_PATHS.STATUS, {
            method: 'POST',
        });

        expect(result.response).toEqual(METHOD_NOT_ALLOWED_RESPONSE);
        expect(mockFirstRendererSend).not.toHaveBeenCalled();
        expect(mockSecondRendererSend).not.toHaveBeenCalled();
    });

    it('floors a finite positive channel number and dispatches it', async () => {
        bootstrapRemoteControl();

        const result = await invokeHttpHandler(
            REMOTE_CONTROL_PATHS.SELECT_NUMBER,
            {
                method: 'POST',
                body: JSON.stringify({ number: 7.9 }),
            }
        );

        expect(result.response).toEqual(SUCCESS_RESPONSE);
        expect(mockFirstRendererSend).toHaveBeenCalledWith(
            'REMOTE_CONTROL_COMMAND',
            {
                type: 'channel-select-number',
                number: 7,
            }
        );
        expect(mockSecondRendererSend).not.toHaveBeenCalled();
    });

    it.each([
        { label: 'missing', body: '{}' },
        { label: 'zero', body: '{"number":0}' },
        { label: 'negative', body: '{"number":-2}' },
        { label: 'infinite', body: '{"number":1e309}' },
        { label: 'nonnumeric', body: '{"number":"seven"}' },
    ])('rejects a $label channel number', async ({ body }) => {
        bootstrapRemoteControl();

        const result = await invokeHttpHandler(
            REMOTE_CONTROL_PATHS.SELECT_NUMBER,
            {
                method: 'POST',
                body,
            }
        );

        expect(result.response).toEqual({
            statusCode: 400,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: 'Invalid channel number' }),
        });
        expect(mockGetAllWindows).not.toHaveBeenCalled();
        expect(mockFirstRendererSend).not.toHaveBeenCalled();
        expect(mockSecondRendererSend).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON without dispatching', async () => {
        bootstrapRemoteControl();

        const result = await invokeHttpHandler(
            REMOTE_CONTROL_PATHS.SELECT_NUMBER,
            {
                method: 'POST',
                body: '{"number":',
            }
        );

        expect(result.response).toEqual({
            statusCode: 400,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: 'Invalid JSON payload' }),
        });
        expect(mockGetAllWindows).not.toHaveBeenCalled();
        expect(mockFirstRendererSend).not.toHaveBeenCalled();
        expect(mockSecondRendererSend).not.toHaveBeenCalled();
    });

    it('accepts a valid JSON request at the 10,240-byte body limit', async () => {
        bootstrapRemoteControl();
        const body = createBodyAtByteLength(10 * 1024);

        const result = await invokeHttpHandler(
            REMOTE_CONTROL_PATHS.SELECT_NUMBER,
            {
                method: 'POST',
                body,
            }
        );

        expect(Buffer.byteLength(body, 'utf8')).toBe(10_240);
        expect(result.response).toEqual(SUCCESS_RESPONSE);
        expect(mockFirstRendererSend).toHaveBeenCalledWith(
            'REMOTE_CONTROL_COMMAND',
            {
                type: 'channel-select-number',
                number: 7,
            }
        );
    });

    it('rejects and destroys a 10,241-byte request without dispatching', async () => {
        bootstrapRemoteControl();
        const body = Buffer.alloc(10 * 1024 + 1, 'x');

        const result = await invokeHttpHandler(
            REMOTE_CONTROL_PATHS.SELECT_NUMBER,
            {
                method: 'POST',
                body,
            }
        );
        await result.requestClosed;

        expect(body.byteLength).toBe(10_241);
        expect(result.response).toEqual({
            statusCode: 413,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: 'Payload too large' }),
        });
        expect(result.request.destroyed).toBe(true);
        expect(result.requestErrors).toEqual([]);
        expect(mockGetAllWindows).not.toHaveBeenCalled();
        expect(mockFirstRendererSend).not.toHaveBeenCalled();
        expect(mockSecondRendererSend).not.toHaveBeenCalled();
    });

    it('merges partial status updates and refreshes updatedAt', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-25T10:00:00.000Z'));
        bootstrapRemoteControl();
        const updateStatus = getIpcListener('REMOTE_CONTROL_STATUS_UPDATE');

        jest.setSystemTime(new Date('2026-07-25T10:01:00.000Z'));
        updateStatus(
            {},
            {
                portal: 'm3u',
                isLiveView: true,
                channelName: 'News',
                volume: 35,
            }
        );
        jest.setSystemTime(new Date('2026-07-25T10:02:00.000Z'));
        updateStatus({}, { channelName: 'Sports', muted: true });

        const result = await invokeHttpHandler(REMOTE_CONTROL_PATHS.STATUS, {
            method: 'GET',
        });

        expect(result.response).toEqual({
            statusCode: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify({
                portal: 'm3u',
                isLiveView: true,
                supportsVolume: false,
                updatedAt: '2026-07-25T10:02:00.000Z',
                channelName: 'Sports',
                volume: 35,
                muted: true,
            }),
        });
    });

    it.each([
        {
            path: REMOTE_CONTROL_PATHS.CHANNEL_UP,
            warning: 'No browser windows found to send channel change',
        },
        {
            path: REMOTE_CONTROL_PATHS.VOLUME_UP,
            warning: 'No browser windows found to send remote command',
        },
    ])(
        'returns success and warns instead of throwing when $path has no renderer',
        async ({ path, warning }) => {
            mockGetAllWindows.mockReturnValue([]);
            bootstrapRemoteControl();

            await expect(
                invokeHttpHandler(path, { method: 'POST' })
            ).resolves.toMatchObject({
                response: SUCCESS_RESPONSE,
            });
            expect(consoleWarn).toHaveBeenCalledWith(warning);
            expect(mockFirstRendererSend).not.toHaveBeenCalled();
            expect(mockSecondRendererSend).not.toHaveBeenCalled();
        }
    );
});
