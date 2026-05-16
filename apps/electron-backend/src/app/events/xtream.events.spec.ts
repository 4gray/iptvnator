import { XTREAM_CANCEL_SESSION } from 'shared-interfaces';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const axiosMock = Object.assign(jest.fn(), {
    isAxiosError: jest.fn(),
});
const mockEnsureSourceNetworkReady = jest.fn();

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            registeredHandlers.set(channel, handler);
        }),
    },
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: axiosMock,
}));

jest.mock('./portal-debug.events', () => ({
    emitPortalDebugEvent: jest.fn(),
}));

jest.mock('../services/source-network-options', () => ({
    ensureSourceNetworkReady: mockEnsureSourceNetworkReady,
    getSourceAxiosAgents: jest.fn(() => ({})),
}));

describe('XtreamEvents session cancellation', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(async () => {
        jest.resetModules();
        registeredHandlers.clear();
        axiosMock.mockReset();
        axiosMock.isAxiosError.mockReset();
        mockEnsureSourceNetworkReady.mockReset();
        mockEnsureSourceNetworkReady.mockResolvedValue(null);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        await import('./xtream.events');
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('prepares source VPN before an Xtream request leaves the process', async () => {
        const requestHandler = registeredHandlers.get('XTREAM_REQUEST');
        expect(requestHandler).toBeDefined();
        axiosMock.mockResolvedValue({
            status: 200,
            data: Buffer.from('{"user_info":{"status":"Active"}}'),
            headers: { 'content-type': 'application/json' },
        });

        await requestHandler?.({}, {
            url: 'http://localhost:3211',
            params: {
                action: 'get_account_info',
                password: 'secret',
                username: 'user1',
            },
            sourceVpn: {
                provider: 'proton',
                location: 'DE',
                sourceId: 'source-1',
            },
        });

        expect(mockEnsureSourceNetworkReady).toHaveBeenCalledWith({
            provider: 'proton',
            location: 'DE',
            sourceId: 'source-1',
        });
        expect(mockEnsureSourceNetworkReady.mock.invocationCallOrder[0]).toBeLessThan(
            axiosMock.mock.invocationCallOrder[0]
        );
    });

    it('normalizes Xtream API URLs without adding duplicate slashes or player_api.php segments', async () => {
        const requestHandler = registeredHandlers.get('XTREAM_REQUEST');
        expect(requestHandler).toBeDefined();
        axiosMock.mockResolvedValue({
            status: 200,
            data: Buffer.from('{"user_info":{"status":"Active"}}'),
            headers: { 'content-type': 'application/json' },
        });

        await requestHandler?.({}, {
            url: ' http://localhost:3211/player_api.php ',
            params: {
                action: 'get_account_info',
                password: 'secret',
                username: 'user1',
            },
        });

        const calledUrl = new URL(axiosMock.mock.calls[0][0].url);
        expect(calledUrl.origin).toBe('http://localhost:3211');
        expect(calledUrl.pathname).toBe('/player_api.php');
        expect(calledUrl.searchParams.get('action')).toBe('get_account_info');
        expect(calledUrl.searchParams.get('password')).toBe('secret');
        expect(calledUrl.searchParams.get('username')).toBe('user1');
    });

    it('retries transient portal failures before returning Portal unavailable to the renderer', async () => {
        const requestHandler = registeredHandlers.get('XTREAM_REQUEST');
        expect(requestHandler).toBeDefined();
        axiosMock
            .mockResolvedValueOnce({
                status: 503,
                statusText: 'Service Unavailable',
                data: Buffer.from(''),
                headers: {},
            })
            .mockResolvedValueOnce({
                status: 200,
                data: Buffer.from('{"user_info":{"status":"Active"}}'),
                headers: { 'content-type': 'application/json' },
            });

        const result = await requestHandler?.({}, {
            url: 'http://localhost:3211/',
            params: {
                action: 'get_account_info',
                password: 'secret',
                username: 'user1',
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                payload: {
                    user_info: {
                        status: 'Active',
                    },
                },
            })
        );
        expect(mockEnsureSourceNetworkReady).toHaveBeenCalledTimes(2);
        expect(axiosMock).toHaveBeenCalledTimes(2);
        const calledUrl = new URL(axiosMock.mock.calls[1][0].url);
        expect(calledUrl.origin).toBe('http://localhost:3211');
        expect(calledUrl.pathname).toBe('/player_api.php');
        expect(calledUrl.searchParams.get('action')).toBe('get_account_info');
        expect(calledUrl.searchParams.get('password')).toBe('secret');
        expect(calledUrl.searchParams.get('username')).toBe('user1');
    });

    it('retries when the source VPN is not ready yet and sends the request only after preparation succeeds', async () => {
        const requestHandler = registeredHandlers.get('XTREAM_REQUEST');
        expect(requestHandler).toBeDefined();
        mockEnsureSourceNetworkReady
            .mockRejectedValueOnce({
                message: 'VPN is required but not ready',
                status: 599,
            })
            .mockResolvedValueOnce(null);
        axiosMock.mockResolvedValue({
            status: 200,
            data: Buffer.from('{"user_info":{"status":"Active"}}'),
            headers: { 'content-type': 'application/json' },
        });

        await requestHandler?.({}, {
            url: 'http://localhost:3211',
            params: {
                action: 'get_account_info',
                password: 'secret',
                username: 'user1',
            },
            sourceVpn: {
                provider: 'proton',
                location: 'HR',
                sourceId: 'source-1',
            },
        });

        expect(mockEnsureSourceNetworkReady).toHaveBeenCalledTimes(2);
        expect(axiosMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry credential or authorization errors', async () => {
        const requestHandler = registeredHandlers.get('XTREAM_REQUEST');
        expect(requestHandler).toBeDefined();
        axiosMock.mockResolvedValue({
            status: 401,
            statusText: 'Unauthorized',
            data: Buffer.from(''),
            headers: {},
        });

        await expect(
            requestHandler?.({}, {
                url: 'http://localhost:3211',
                params: {
                    action: 'get_account_info',
                    password: 'bad',
                    username: 'user1',
                },
                suppressErrorLog: true,
            })
        ).rejects.toMatchObject({
            status: 401,
        });
        expect(axiosMock).toHaveBeenCalledTimes(1);
    });

    it('aborts requests that were registered with only a session id', async () => {
        const requestHandler = registeredHandlers.get('XTREAM_REQUEST');
        const cancelHandler = registeredHandlers.get(XTREAM_CANCEL_SESSION);
        const pendingRequest = createDeferred<{ status: number; data: unknown }>();
        const cancelError = Object.assign(new Error('cancelled'), {
            code: 'ERR_CANCELED',
        });
        let abortSignal: AbortSignal | undefined;

        expect(requestHandler).toBeDefined();
        expect(cancelHandler).toBeDefined();

        axiosMock.mockImplementation((config: { signal?: AbortSignal }) => {
            abortSignal = config.signal;
            return pendingRequest.promise;
        });
        axiosMock.isAxiosError.mockImplementation(
            (error: unknown) => error === cancelError
        );

        const requestPromise = requestHandler?.({}, {
            url: 'http://localhost:3211',
            params: {
                action: 'get_live_categories',
                password: 'secret',
                username: 'user1',
            },
            sessionId: 'session-1',
            suppressErrorLog: true,
        }) as Promise<unknown>;

        await Promise.resolve();
        expect(abortSignal?.aborted).toBe(false);

        const cancelResult = (await cancelHandler?.(
            {},
            'session-1'
        )) as { success: boolean; cancelled: number };

        expect(cancelResult).toEqual({ success: true, cancelled: 1 });
        expect(abortSignal?.aborted).toBe(true);

        pendingRequest.reject(cancelError);

        await expect(requestPromise).rejects.toMatchObject({
            name: 'AbortError',
            status: 499,
        });
    });

    it('counts every matching in-flight request for the same session', async () => {
        const requestHandler = registeredHandlers.get('XTREAM_REQUEST');
        const cancelHandler = registeredHandlers.get(XTREAM_CANCEL_SESSION);
        const firstRequest = createDeferred<{ status: number; data: unknown }>();
        const secondRequest = createDeferred<{ status: number; data: unknown }>();
        const cancelError = Object.assign(new Error('cancelled'), {
            code: 'ERR_CANCELED',
        });
        const abortSignals: AbortSignal[] = [];

        expect(requestHandler).toBeDefined();
        expect(cancelHandler).toBeDefined();

        axiosMock
            .mockImplementationOnce((config: { signal?: AbortSignal }) => {
                if (config.signal) {
                    abortSignals.push(config.signal);
                }
                return firstRequest.promise;
            })
            .mockImplementationOnce((config: { signal?: AbortSignal }) => {
                if (config.signal) {
                    abortSignals.push(config.signal);
                }
                return secondRequest.promise;
            });
        axiosMock.isAxiosError.mockImplementation(
            (error: unknown) => error === cancelError
        );

        const firstPromise = requestHandler?.({}, {
            url: 'http://localhost:3211',
            params: {
                action: 'get_live_categories',
                password: 'secret',
                username: 'user1',
            },
            sessionId: 'session-2',
            suppressErrorLog: true,
        }) as Promise<unknown>;
        const secondPromise = requestHandler?.({}, {
            url: 'http://localhost:3211',
            params: {
                action: 'get_vod_streams',
                password: 'secret',
                username: 'user1',
            },
            sessionId: 'session-2',
            suppressErrorLog: true,
        }) as Promise<unknown>;

        await Promise.resolve();
        const cancelResult = (await cancelHandler?.(
            {},
            'session-2'
        )) as { success: boolean; cancelled: number };

        expect(cancelResult).toEqual({ success: true, cancelled: 2 });
        expect(abortSignals).toHaveLength(2);
        expect(abortSignals.every((signal) => signal.aborted)).toBe(true);

        firstRequest.reject(cancelError);
        secondRequest.reject(cancelError);

        await expect(firstPromise).rejects.toMatchObject({ name: 'AbortError' });
        await expect(secondPromise).rejects.toMatchObject({ name: 'AbortError' });
    });
});
