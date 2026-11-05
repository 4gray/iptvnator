import type { BeforeSendResponse } from 'electron';

type IpcHandler = (event: unknown, ...args: unknown[]) => boolean;
type WebRequestListener = (
    details: { url: string; requestHeaders: Record<string, string> },
    callback: (result: BeforeSendResponse) => void
) => void;

const mockHandle = jest.fn<void, [string, IpcHandler]>();
const mockOnBeforeSendHeaders = jest.fn<void, [unknown, WebRequestListener]>();

jest.mock('electron', () => ({
    ipcMain: { handle: mockHandle },
    session: {
        defaultSession: {
            webRequest: { onBeforeSendHeaders: mockOnBeforeSendHeaders },
        },
    },
}));

const stream = 'https://stream.example/movie';
const referer = 'https://portal.example/watch';
const origin = 'https://origin.example';

function requestHeaders(url: string) {
    const listener = mockOnBeforeSendHeaders.mock.calls[0]?.[1];
    if (!listener) return {};
    const callback = jest.fn<void, [BeforeSendResponse]>();
    listener({ url, requestHeaders: {} }, callback);
    return callback.mock.calls[0][0].requestHeaders;
}

describe('set-user-agent IPC', () => {
    let invoke: IpcHandler;

    beforeEach(async () => {
        jest.resetModules();
        jest.clearAllMocks();
        await import('./shared.events');
        const registration = mockHandle.mock.calls.find(
            ([channel]) => channel === 'set-user-agent'
        );
        if (!registration)
            throw new Error('Missing set-user-agent IPC handler');
        invoke = registration[1];
    });

    it('passes the distinct Origin and restricts credentials to the stream host', () => {
        const credentials = { cookie: 'session=synthetic', authorization: 42 };
        expect(
            invoke({}, 'ExampleAgent', referer, stream, credentials, origin)
        ).toBe(true);

        const publicHeaders = {
            'User-Agent': 'ExampleAgent',
            Referer: referer,
            Origin: origin,
        };
        expect(requestHeaders(stream)).toEqual({
            ...publicHeaders,
            Cookie: 'session=synthetic',
        });
        expect(requestHeaders(referer)).toEqual(publicHeaders);
        expect(requestHeaders(origin)).toEqual({});
    });

    it('sets an Origin-only override and clears it when playback ends', () => {
        invoke({}, undefined, undefined, stream, undefined, origin);
        expect(requestHeaders(stream)).toEqual({ Origin: origin });
        invoke({}, undefined, undefined, stream);
        expect(requestHeaders(stream)).toEqual({});
    });

    it('derives the Origin from Referer for callers omitting the fifth argument', () => {
        invoke({}, undefined, referer, stream, {
            authorization: 'Bearer synthetic',
        });
        expect(requestHeaders(stream)).toEqual({
            Referer: referer,
            Origin: 'https://portal.example',
            Authorization: 'Bearer synthetic',
        });
    });
});
