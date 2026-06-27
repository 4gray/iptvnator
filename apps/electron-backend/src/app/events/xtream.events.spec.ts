import { XTREAM_CANCEL_SESSION } from '@iptvnator/shared/interfaces';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const axiosMock = Object.assign(jest.fn(), {
    isAxiosError: jest.fn(),
});

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
        handle: jest.fn(
            (channel: string, handler: (...args: unknown[]) => unknown) => {
                registeredHandlers.set(channel, handler);
            }
        ),
    },
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: axiosMock,
}));

jest.mock('./portal-debug.events', () => ({
    emitPortalDebugEvent: jest.fn(),
}));

describe('XtreamEvents session cancellation', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(async () => {
        jest.resetModules();
        registeredHandlers.clear();
        axiosMock.mockReset();
        axiosMock.isAxiosError.mockReset();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        await import('./xtream.events');
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('normalizes full Xtream API URLs before appending player_api.php', async () => {
        const requestHandler = registeredHandlers.get('XTREAM_REQUEST');
        expect(requestHandler).toBeDefined();

        axiosMock.mockResolvedValue({
            status: 200,
            data: { ok: true },
            headers: {},
        });

        await requestHandler?.(
            {},
            {
                url: 'https://example.com/base/player_api.php?username=old&password=old',
                params: {
                    action: 'get_account_info',
                    password: ' pass ',
                    username: ' user ',
                },
                suppressErrorLog: true,
            }
        );

        const requestedUrl = new URL(axiosMock.mock.calls[0][0].url);
        expect(`${requestedUrl.origin}${requestedUrl.pathname}`).toBe(
            'https://example.com/base/player_api.php'
        );
        expect(requestedUrl.searchParams.get('action')).toBe(
            'get_account_info'
        );
        expect(requestedUrl.searchParams.get('password')).toBe('pass');
        expect(requestedUrl.searchParams.get('username')).toBe('user');
    });

    it('follows validated redirects for range GET media probes', async () => {
        const probeHandler = registeredHandlers.get('XTREAM_PROBE_URL');
        const destroyProbeBody = jest.fn();
        expect(probeHandler).toBeDefined();

        axiosMock
            .mockImplementationOnce((config: { url?: string }) =>
                Promise.resolve({
                    status: 302,
                    headers: { location: '/media.ts' },
                    config,
                })
            )
            .mockImplementationOnce((config: { url?: string }) =>
                Promise.resolve({
                    status: 206,
                    headers: {},
                    data: { destroy: destroyProbeBody },
                    config,
                })
            );

        const result = (await probeHandler?.(
            {},
            {
                url: 'http://localhost:3211/streaming/timeshift.php?stream=45',
                method: 'GET',
            }
        )) as { status: number; url: string };

        expect(result.status).toBe(206);
        expect(result.url).toBe('http://localhost:3211/media.ts');
        expect(axiosMock).toHaveBeenCalledTimes(2);
        const firstRequest = axiosMock.mock.calls[0][0] as {
            headers?: Record<string, string>;
            maxRedirects?: number;
            method?: string;
            responseType?: string;
        };
        expect(firstRequest.method).toBe('GET');
        expect(firstRequest.headers).toEqual(
            expect.objectContaining({ Range: 'bytes=0-4095' })
        );
        expect(firstRequest.maxRedirects).toBe(0);
        expect(firstRequest.responseType).toBe('stream');
        expect(destroyProbeBody).toHaveBeenCalledTimes(1);
    });

    it('rejects private cross-origin redirects for range GET media probes', async () => {
        const probeHandler = registeredHandlers.get('XTREAM_PROBE_URL');
        expect(probeHandler).toBeDefined();

        axiosMock.mockResolvedValueOnce({
            status: 302,
            headers: { location: 'http://127.0.0.1/admin' },
            config: {
                url: 'http://localhost:3211/streaming/timeshift.php?stream=45',
            },
        });

        const result = (await probeHandler?.(
            {},
            {
                url: 'http://localhost:3211/streaming/timeshift.php?stream=45',
                method: 'GET',
            }
        )) as { error?: string; status: number; url: string };

        expect(result).toEqual({
            error: 'URL points to a private or local network address',
            status: 0,
            url: 'http://localhost:3211/streaming/timeshift.php?stream=45',
        });
        expect(axiosMock).toHaveBeenCalledTimes(1);
    });

    it('aborts requests that were registered with only a session id', async () => {
        const requestHandler = registeredHandlers.get('XTREAM_REQUEST');
        const cancelHandler = registeredHandlers.get(XTREAM_CANCEL_SESSION);
        const pendingRequest = createDeferred<{
            status: number;
            data: unknown;
        }>();
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

        const requestPromise = requestHandler?.(
            {},
            {
                url: 'http://localhost:3211',
                params: {
                    action: 'get_live_categories',
                    password: 'secret',
                    username: 'user1',
                },
                sessionId: 'session-1',
                suppressErrorLog: true,
            }
        ) as Promise<unknown>;

        await Promise.resolve();
        expect(abortSignal?.aborted).toBe(false);

        const cancelResult = (await cancelHandler?.({}, 'session-1')) as {
            success: boolean;
            cancelled: number;
        };

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
        const firstRequest = createDeferred<{
            status: number;
            data: unknown;
        }>();
        const secondRequest = createDeferred<{
            status: number;
            data: unknown;
        }>();
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

        const firstPromise = requestHandler?.(
            {},
            {
                url: 'http://localhost:3211',
                params: {
                    action: 'get_live_categories',
                    password: 'secret',
                    username: 'user1',
                },
                sessionId: 'session-2',
                suppressErrorLog: true,
            }
        ) as Promise<unknown>;
        const secondPromise = requestHandler?.(
            {},
            {
                url: 'http://localhost:3211',
                params: {
                    action: 'get_vod_streams',
                    password: 'secret',
                    username: 'user1',
                },
                sessionId: 'session-2',
                suppressErrorLog: true,
            }
        ) as Promise<unknown>;

        await Promise.resolve();
        const cancelResult = (await cancelHandler?.({}, 'session-2')) as {
            success: boolean;
            cancelled: number;
        };

        expect(cancelResult).toEqual({ success: true, cancelled: 2 });
        expect(abortSignals).toHaveLength(2);
        expect(abortSignals.every((signal) => signal.aborted)).toBe(true);

        firstRequest.reject(cancelError);
        secondRequest.reject(cancelError);

        await expect(firstPromise).rejects.toMatchObject({
            name: 'AbortError',
        });
        await expect(secondPromise).rejects.toMatchObject({
            name: 'AbortError',
        });
    });
});
