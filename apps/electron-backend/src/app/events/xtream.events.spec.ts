import {
    CONNECTIVITY_GUARD_RESET,
    XTREAM_CANCEL_SESSION,
    buildHostConnectivityFastFailMessage,
} from '@iptvnator/shared/interfaces';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const axiosMock = Object.assign(jest.fn(), {
    isAxiosError: jest.fn(),
});
const PERF_CAPTURE_ENV = 'IPTVNATOR_PERF_CAPTURE';
const originalPerformanceCaptureValue = process.env[PERF_CAPTURE_ENV];

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
        delete process.env[PERF_CAPTURE_ENV];
        registeredHandlers.clear();
        axiosMock.mockReset();
        axiosMock.isAxiosError.mockReset();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        await import('./xtream.events');
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    afterAll(() => {
        if (originalPerformanceCaptureValue === undefined) {
            delete process.env[PERF_CAPTURE_ENV];
        } else {
            process.env[PERF_CAPTURE_ENV] = originalPerformanceCaptureValue;
        }
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

    it('sends a player-style User-Agent instead of a truncated browser string', async () => {
        // Regression: some Xtream panels sit behind a WAF (e.g. Cloudflare)
        // that challenges generic/incomplete browser User-Agents but
        // allowlists known IPTV player clients. The previous hardcoded
        // 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        // string was rejected by such panels even though curl/Safari worked.
        const requestHandler = registeredHandlers.get('XTREAM_REQUEST');
        expect(requestHandler).toBeDefined();

        axiosMock.mockResolvedValue({
            status: 200,
            data: { user_info: { auth: 1, status: 'Active' } },
            headers: {},
        });

        await requestHandler?.(
            {},
            {
                url: 'https://example.com',
                params: {
                    action: 'get_account_info',
                    password: 'pass',
                    username: 'user',
                },
                suppressErrorLog: true,
            }
        );

        const requestConfig = axiosMock.mock.calls[0][0] as {
            headers?: Record<string, string>;
        };
        const userAgent = requestConfig.headers?.['User-Agent'];
        expect(userAgent).toBeDefined();
        expect(userAgent).not.toBe(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        );
        expect(userAgent).not.toMatch(/^Mozilla\/5\.0 /);
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

describe('XtreamEvents host connectivity guard', () => {
    const GUARD_DISABLED_ENV = 'IPTVNATOR_DISABLE_CONNECTIVITY_GUARD';
    const SERVER_URL = 'http://dead-panel.example.com:8080';
    const SERVER_ENDPOINT = 'http://dead-panel.example.com:8080';
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let requestHandler: (...args: unknown[]) => unknown;
    let resetHandler: (...args: unknown[]) => unknown;

    const timedOut = () =>
        Object.assign(new Error('timeout of 30000ms exceeded'), {
            code: 'ETIMEDOUT',
        });

    const request = (url = SERVER_URL) =>
        requestHandler(
            {},
            {
                url,
                params: {
                    action: 'get_live_categories',
                    password: 'secret',
                    username: 'user1',
                },
                suppressErrorLog: true,
            }
        ) as Promise<unknown>;

    beforeEach(async () => {
        jest.resetModules();
        delete process.env[PERF_CAPTURE_ENV];
        delete process.env[GUARD_DISABLED_ENV];
        registeredHandlers.clear();
        axiosMock.mockReset();
        axiosMock.isAxiosError.mockReset();
        axiosMock.isAxiosError.mockReturnValue(true);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await import('./xtream.events');
        // Same fresh module registry as the handler above, so both talk to the
        // same guard instance.
        const guardEvents = await import('./connectivity-guard.events');
        guardEvents.registerConnectivityGuardHandlers();
        requestHandler = registeredHandlers.get('XTREAM_REQUEST') as (
            ...args: unknown[]
        ) => unknown;
        resetHandler = registeredHandlers.get(CONNECTIVITY_GUARD_RESET) as (
            ...args: unknown[]
        ) => unknown;
        expect(requestHandler).toBeDefined();
        expect(resetHandler).toBeDefined();
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        delete process.env[GUARD_DISABLED_ENV];
    });

    it.each(['success', 'failure', 'cancel', 'redirect-failure'])(
        'holds a long request or redirect-chain trial until %s settles',
        async (outcome) => {
            let now = 1_000;
            const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
            const finalHop = createDeferred<unknown>();
            const arrived = createDeferred<void>();
            let trial: Promise<unknown> | undefined;
            const expectedCalls = outcome === 'failure' ? 3 : 5;
            try {
                axiosMock.mockRejectedValue(timedOut());
                await expect(request()).rejects.toBeDefined();
                await expect(request()).rejects.toBeDefined();
                now += 30_001;
                // Direct failure uses a slow pending transfer. Other outcomes
                // traverse the real validated-axios loop with two 25 s hops.
                if (outcome !== 'failure') {
                    axiosMock
                        .mockImplementationOnce(async () => {
                            now += 25_000;
                            return {
                                status: 302,
                                headers: { location: '/second' },
                            };
                        })
                        .mockImplementationOnce(async () => {
                            now += 25_000;
                            return {
                                status: 302,
                                headers: { location: '/third' },
                            };
                        });
                }
                axiosMock.mockImplementationOnce(() => {
                    if (outcome === 'failure') now += 50_000;
                    arrived.resolve();
                    return finalHop.promise;
                });
                trial = request().then(
                    (value) => ({ value }),
                    (error) => ({ error })
                );
                await arrived.promise;
                await expect(request()).rejects.toThrow(
                    buildHostConnectivityFastFailMessage(SERVER_ENDPOINT)
                );
                expect(axiosMock).toHaveBeenCalledTimes(expectedCalls);
                if (outcome === 'success') {
                    finalHop.resolve({ status: 200, data: [], headers: {} });
                } else {
                    finalHop.reject(
                        Object.assign(timedOut(), {
                            code:
                                outcome === 'cancel'
                                    ? 'ERR_CANCELED'
                                    : 'ETIMEDOUT',
                            config: {
                                url:
                                    outcome === 'redirect-failure'
                                        ? `${SERVER_URL}/third`
                                        : `${SERVER_URL}/player_api.php`,
                            },
                        })
                    );
                }
                await trial;
                if (outcome === 'failure') {
                    await expect(request()).rejects.toThrow(
                        buildHostConnectivityFastFailMessage(SERVER_ENDPOINT)
                    );
                    now += 30_001;
                }
                axiosMock.mockResolvedValue({
                    status: 200,
                    data: [],
                    headers: {},
                });
                await expect(request()).resolves.toMatchObject({ payload: [] });
                expect(axiosMock).toHaveBeenCalledTimes(expectedCalls + 1);
            } finally {
                finalHop.resolve({ status: 200, data: [], headers: {} });
                await trial;
                clock.mockRestore();
            }
        }
    );

    it('ignores an old pending trial failure after reset while a replacement is active', async () => {
        let now = 1_000;
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        const old = createDeferred<unknown>();
        const replacement = createDeferred<unknown>();
        const oldStarted = createDeferred<void>();
        const replacementStarted = createDeferred<void>();
        let oldRequest: Promise<unknown> | undefined;
        let newRequest: Promise<unknown> | undefined;
        try {
            axiosMock.mockRejectedValue(timedOut());
            await expect(request()).rejects.toBeDefined();
            await expect(request()).rejects.toBeDefined();
            now += 30_001;
            axiosMock.mockImplementationOnce(() => {
                oldStarted.resolve();
                return old.promise;
            });
            oldRequest = request().catch((error) => error);
            await oldStarted.promise;
            await resetHandler({}, { url: SERVER_URL });
            await expect(request()).rejects.toBeDefined();
            await expect(request()).rejects.toBeDefined();
            now += 30_001;
            axiosMock.mockImplementationOnce(() => {
                replacementStarted.resolve();
                return replacement.promise;
            });
            newRequest = request();
            await replacementStarted.promise;
            old.reject(timedOut());
            await oldRequest;
            now += 45_001;
            await expect(request()).rejects.toThrow(
                buildHostConnectivityFastFailMessage(SERVER_ENDPOINT)
            );
            expect(axiosMock).toHaveBeenCalledTimes(6);
            replacement.resolve({ status: 200, data: [], headers: {} });
            await expect(newRequest).resolves.toMatchObject({ payload: [] });
        } finally {
            old.resolve({ status: 200, data: [], headers: {} });
            replacement.resolve({ status: 200, data: [], headers: {} });
            await Promise.all([oldRequest, newRequest]);
            clock.mockRestore();
        }
    });

    it('releases the trial in finally when debug reporting throws before the outcome report', async () => {
        let now = 1_000;
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        const debug = await import('./portal-debug.events');
        const reportingError = new Error('debug reporting failed');
        try {
            axiosMock.mockRejectedValue(timedOut());
            await expect(request()).rejects.toBeDefined();
            await expect(request()).rejects.toBeDefined();
            now += 30_001;
            jest.mocked(debug.emitPortalDebugEvent).mockImplementationOnce(
                () => {
                    throw reportingError;
                }
            );
            await expect(
                requestHandler(
                    {},
                    {
                        url: SERVER_URL,
                        params: { action: 'get_live_categories' },
                        requestId: 'debug-trial',
                    }
                )
            ).rejects.toBe(reportingError);
            axiosMock.mockResolvedValue({ status: 200, data: [], headers: {} });
            await expect(request()).resolves.toBeDefined();
            expect(axiosMock).toHaveBeenCalledTimes(4);
        } finally {
            jest.mocked(debug.emitPortalDebugEvent).mockReset();
            clock.mockRestore();
        }
    });

    it('stops contacting a panel that timed out twice in a row', async () => {
        axiosMock.mockRejectedValue(timedOut());

        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toBeDefined();
        expect(axiosMock).toHaveBeenCalledTimes(2);

        await expect(request()).rejects.toThrow(
            buildHostConnectivityFastFailMessage(SERVER_ENDPOINT)
        );
        // The whole point: no third 30-second wait.
        expect(axiosMock).toHaveBeenCalledTimes(2);
    });

    it('keeps other panels reachable', async () => {
        axiosMock.mockRejectedValue(timedOut());
        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toBeDefined();

        // The normal axios path rejects with a plain object, not an Error —
        // only the guard's own rejection is an Error instance.
        await expect(
            request('http://other-panel.example.com')
        ).rejects.toMatchObject({ message: 'timeout of 30000ms exceeded' });
        expect(axiosMock).toHaveBeenCalledTimes(3);
    });

    it('treats a 5xx as proof the panel is alive', async () => {
        const serverError = Object.assign(new Error('Request failed'), {
            code: 'ERR_BAD_RESPONSE',
            response: { status: 502, statusText: 'Bad Gateway', data: {} },
        });
        axiosMock
            .mockRejectedValue(timedOut())
            .mockRejectedValueOnce(timedOut())
            .mockRejectedValueOnce(serverError);

        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toBeDefined();

        // Two timeouts happened, but the 502 between them broke the streak.
        await expect(request()).rejects.toBeDefined();
        expect(axiosMock).toHaveBeenCalledTimes(4);
    });

    it('does not count a cancelled request against the panel', async () => {
        const cancelled = Object.assign(new Error('canceled'), {
            code: 'ERR_CANCELED',
        });
        axiosMock.mockRejectedValue(cancelled);

        await expect(request()).rejects.toMatchObject({ status: 499 });
        await expect(request()).rejects.toMatchObject({ status: 499 });
        await expect(request()).rejects.toMatchObject({ status: 499 });

        expect(axiosMock).toHaveBeenCalledTimes(3);
    });

    it('does not log a line per skipped request', async () => {
        // suppressErrorLog is set above, so assert on the unsuppressed path.
        axiosMock.mockRejectedValue(timedOut());
        const loud = () =>
            requestHandler(
                {},
                {
                    url: SERVER_URL,
                    params: { action: 'get_vod_streams' },
                }
            ) as Promise<unknown>;

        await expect(loud()).rejects.toBeDefined();
        await expect(loud()).rejects.toBeDefined();
        expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
        consoleErrorSpy.mockClear();

        await expect(loud()).rejects.toBeDefined();

        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('contacts the panel again once the guard is reset', async () => {
        axiosMock.mockRejectedValue(timedOut());
        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toThrow(
            buildHostConnectivityFastFailMessage(SERVER_ENDPOINT)
        );

        await expect(resetHandler({}, { url: SERVER_URL })).resolves.toEqual({
            success: true,
        });

        await expect(request()).rejects.toMatchObject({
            message: 'timeout of 30000ms exceeded',
        });
        expect(axiosMock).toHaveBeenCalledTimes(3);
    });

    it('reports a reset it could not apply instead of pretending it worked', async () => {
        await expect(resetHandler({}, { url: 'not a url' })).resolves.toEqual({
            success: false,
        });
        await expect(resetHandler({}, {})).resolves.toEqual({
            success: false,
        });
        await expect(resetHandler({}, undefined)).resolves.toEqual({
            success: false,
        });
    });

    it('never blocks a request while the kill switch is set', async () => {
        process.env[GUARD_DISABLED_ENV] = '1';
        axiosMock.mockRejectedValue(timedOut());

        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toMatchObject({
            message: 'timeout of 30000ms exceeded',
        });

        expect(axiosMock).toHaveBeenCalledTimes(3);
    });
});
