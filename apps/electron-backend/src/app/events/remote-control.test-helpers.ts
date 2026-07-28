import type * as http from 'node:http';
import { PassThrough } from 'node:stream';

/**
 * Shared harness for the remote-control specs.
 *
 * Every exported mock is `mock`-prefixed so the spec files can reference them
 * from their hoisted `jest.mock()` factories.
 */

export type HttpHandler = (
    request: http.IncomingMessage,
    response: http.ServerResponse
) => void;
export type IpcCallback = (...args: unknown[]) => unknown;

export interface RemoteControlSettings {
    enabled: boolean;
    port: number;
}

export interface ResponseSnapshot {
    statusCode: number;
    headers: http.OutgoingHttpHeaders;
    body: string;
}

export interface ResponseRecorder {
    response: http.ServerResponse;
    completed: Promise<ResponseSnapshot>;
}

export interface RequestInvocation {
    response: ResponseSnapshot;
    request: PassThrough;
    requestClosed: Promise<void>;
    requestErrors: Error[];
}

export interface InvokeOptions {
    method: string;
    body?: string | Buffer;
}

export const REMOTE_CONTROL_PATHS = {
    STATUS: '/api/remote-control/status',
    SELECT_NUMBER: '/api/remote-control/channel/select-number',
    CHANNEL_UP: '/api/remote-control/channel/up',
    CHANNEL_DOWN: '/api/remote-control/channel/down',
    VOLUME_UP: '/api/remote-control/volume/up',
    VOLUME_DOWN: '/api/remote-control/volume/down',
    VOLUME_TOGGLE_MUTE: '/api/remote-control/volume/toggle-mute',
} as const;

export const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
export const SUCCESS_RESPONSE = {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({ success: true }),
} as const;
export const METHOD_NOT_ALLOWED_RESPONSE = {
    statusCode: 405,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: 'Method not allowed' }),
} as const;

export const mockHttpHandlers = new Map<string, HttpHandler>();
export const mockIpcHandlers = new Map<string, IpcCallback>();
export const mockIpcListeners = new Map<string, IpcCallback>();
export const mockRegisterRemoteControlHandler = jest.fn(
    (path: string, handler: HttpHandler) => {
        mockHttpHandlers.set(path, handler);
    }
);
export const mockStartHttpServer = jest.fn();
export const mockStoreGet = jest.fn();
export const mockFirstRendererSend = jest.fn();
export const mockSecondRendererSend = jest.fn();
export const mockGetAllWindows = jest.fn();
export const mockIpcHandle = jest.fn(
    (channel: string, handler: IpcCallback) => {
        mockIpcHandlers.set(channel, handler);
    }
);
export const mockIpcOn = jest.fn((channel: string, listener: IpcCallback) => {
    mockIpcListeners.set(channel, listener);
});

/** Restore every mock to the state each spec's `beforeEach` expects. */
export function resetRemoteControlMocks(): void {
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
}

export function createResponseRecorder(): ResponseRecorder {
    let statusCode = 0;
    let headers: http.OutgoingHttpHeaders = {};
    let responseEnded = false;
    let resolveCompleted: (snapshot: ResponseSnapshot) => void = () => {
        throw new Error('Response completion promise is not initialized');
    };
    const completed = new Promise<ResponseSnapshot>((resolve) => {
        resolveCompleted = resolve;
    });

    const response = {
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

export function getHttpHandler(path: string): HttpHandler {
    const handler = mockHttpHandlers.get(path);
    if (!handler) {
        throw new Error(`Expected HTTP handler for ${path}`);
    }

    return handler;
}

export function getIpcHandler(channel: string): IpcCallback {
    const handler = mockIpcHandlers.get(channel);
    if (!handler) {
        throw new Error(`Expected IPC handler for ${channel}`);
    }

    return handler;
}

export function getIpcListener(channel: string): IpcCallback {
    const listener = mockIpcListeners.get(channel);
    if (!listener) {
        throw new Error(`Expected IPC listener for ${channel}`);
    }

    return listener;
}

/**
 * Construct and bootstrap the events class under test. The constructor is
 * injected so this module never imports the subject — the spec files own that
 * import order relative to their `jest.mock()` calls.
 */
export function bootstrapRemoteControl<
    T extends { bootstrapRemoteControlEvents(): unknown },
>(
    RemoteControlEvents: new () => T,
    settings: RemoteControlSettings = { enabled: false, port: 8765 }
): T {
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

export async function invokeHttpHandler(
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

export function createBodyAtByteLength(byteLength: number): string {
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
