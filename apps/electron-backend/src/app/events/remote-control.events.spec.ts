import type * as http from 'node:http';
import { PassThrough } from 'node:stream';

type HttpHandler = (
    request: http.IncomingMessage,
    response: http.ServerResponse
) => void;
type IpcCallback = (...args: unknown[]) => unknown;

interface RemoteControlSettings {
    enabled: boolean;
    port: number;
}

interface ResponseSnapshot {
    statusCode: number;
    headers: http.OutgoingHttpHeaders;
    body: string;
}

interface ResponseRecorder {
    response: http.ServerResponse;
    completed: Promise<ResponseSnapshot>;
}

interface RequestInvocation {
    response: ResponseSnapshot;
    request: PassThrough;
    requestClosed: Promise<void>;
    requestErrors: Error[];
}

interface InvokeOptions {
    method: string;
    body?: string | Buffer;
}

const REMOTE_CONTROL_PATHS = {
    STATUS: '/api/remote-control/status',
    SELECT_NUMBER: '/api/remote-control/channel/select-number',
    CHANNEL_UP: '/api/remote-control/channel/up',
    CHANNEL_DOWN: '/api/remote-control/channel/down',
    VOLUME_UP: '/api/remote-control/volume/up',
    VOLUME_DOWN: '/api/remote-control/volume/down',
    VOLUME_TOGGLE_MUTE: '/api/remote-control/volume/toggle-mute',
} as const;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const SUCCESS_RESPONSE = {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({ success: true }),
} as const;
const METHOD_NOT_ALLOWED_RESPONSE = {
    statusCode: 405,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: 'Method not allowed' }),
} as const;

const mockHttpHandlers = new Map<string, HttpHandler>();
const mockIpcHandlers = new Map<string, IpcCallback>();
const mockIpcListeners = new Map<string, IpcCallback>();
const mockRegisterRemoteControlHandler = jest.fn(
    (path: string, handler: HttpHandler) => {
        mockHttpHandlers.set(path, handler);
    }
);
const mockStartHttpServer = jest.fn();
const mockStoreGet = jest.fn();
const mockFirstRendererSend = jest.fn();
const mockSecondRendererSend = jest.fn();
const mockGetAllWindows = jest.fn();
const mockIpcHandle = jest.fn((channel: string, handler: IpcCallback) => {
    mockIpcHandlers.set(channel, handler);
});
const mockIpcOn = jest.fn((channel: string, listener: IpcCallback) => {
    mockIpcListeners.set(channel, listener);
});

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

function createResponseRecorder(): ResponseRecorder {
    let statusCode = 0;
    let headers: http.OutgoingHttpHeaders = {};
    let response: http.ServerResponse;
    let responseEnded = false;
    let resolveCompleted: (snapshot: ResponseSnapshot) => void = () => {
        throw new Error('Response completion promise is not initialized');
    };
    const completed = new Promise<ResponseSnapshot>((resolve) => {
        resolveCompleted = resolve;
    });

    response = {
        writeHead: (
            nextStatusCode: number,
            nextHeaders?: http.OutgoingHttpHeaders
        ) => {
            statusCode = nextStatusCode;
            headers = { ...nextHeaders };
            return response;
        },
        end: (chunk?: string | Uint8Array) => {
            if (responseEnded) {
                throw new Error('Response ended more than once');
            }
            responseEnded = true;
            const body =
                typeof chunk === 'string'
                    ? chunk
                    : chunk
                      ? Buffer.from(chunk).toString('utf8')
                      : '';
            resolveCompleted({ statusCode, headers, body });
            return response;
        },
    } as unknown as http.ServerResponse;

    return { response, completed };
}

function getHttpHandler(path: string): HttpHandler {
    const handler = mockHttpHandlers.get(path);
    if (!handler) {
        throw new Error(`Expected HTTP handler for ${path}`);
    }

    return handler;
}

function getIpcHandler(channel: string): IpcCallback {
    const handler = mockIpcHandlers.get(channel);
    if (!handler) {
        throw new Error(`Expected IPC handler for ${channel}`);
    }

    return handler;
}

function getIpcListener(channel: string): IpcCallback {
    const listener = mockIpcListeners.get(channel);
    if (!listener) {
        throw new Error(`Expected IPC listener for ${channel}`);
    }

    return listener;
}

function bootstrapRemoteControl(
    settings: RemoteControlSettings = { enabled: false, port: 8765 }
): RemoteControlEvents {
    mockStoreGet.mockImplementation(
        (key: string, fallbackValue: unknown): unknown => {
            if (key === 'remoteControl') {
                return settings.enabled;
            }
            if (key === 'remoteControlPort') {
                return settings.port;
            }

            return fallbackValue;
        }
    );

    const events = new RemoteControlEvents();
    events.bootstrapRemoteControlEvents();
    return events;
}

async function invokeHttpHandler(
    path: string,
    options: InvokeOptions
): Promise<RequestInvocation> {
    const request = new PassThrough();
    const requestErrors: Error[] = [];
    request.on('error', (error: Error) => {
        requestErrors.push(error);
    });
    const requestClosed = new Promise<void>((resolve) => {
        request.once('close', resolve);
    });
    const incomingMessage = Object.assign(request, {
        method: options.method,
        url: path,
    }) as unknown as http.IncomingMessage;
    const recorder = createResponseRecorder();

    getHttpHandler(path)(incomingMessage, recorder.response);
    request.end(options.body);

    return {
        response: await recorder.completed,
        request,
        requestClosed,
        requestErrors,
    };
}

function createBodyAtByteLength(byteLength: number): string {
    const prefix = '{"number":7,"padding":"';
    const suffix = '"}';
    const paddingLength =
        byteLength -
        Buffer.byteLength(prefix, 'utf8') -
        Buffer.byteLength(suffix, 'utf8');
    if (paddingLength < 0) {
        throw new Error(`Cannot create a JSON body at ${byteLength} bytes`);
    }

    const body = `${prefix}${'x'.repeat(paddingLength)}${suffix}`;
    if (Buffer.byteLength(body, 'utf8') !== byteLength) {
        throw new Error(`Expected a ${byteLength}-byte JSON body`);
    }

    return body;
}

describe('RemoteControlEvents', () => {
    let consoleLog: jest.SpyInstance;
    let consoleWarn: jest.SpyInstance;

    beforeEach(() => {
        mockHttpHandlers.clear();
        mockIpcHandlers.clear();
        mockIpcListeners.clear();
        mockRegisterRemoteControlHandler.mockClear();
        mockStartHttpServer.mockReset();
        mockStoreGet.mockReset();
        mockFirstRendererSend.mockReset();
        mockSecondRendererSend.mockReset();
        mockGetAllWindows.mockReset();
        mockIpcHandle.mockClear();
        mockIpcOn.mockClear();
        mockGetAllWindows.mockReturnValue([
            { webContents: { send: mockFirstRendererSend } },
            { webContents: { send: mockSecondRendererSend } },
        ]);
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
