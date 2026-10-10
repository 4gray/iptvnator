import {
    STALKER_REQUEST,
    buildHostConnectivityFastFailMessage,
    readPortalRequestFailure,
} from '@iptvnator/shared/interfaces';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const axiosMock = Object.assign(jest.fn(), {
    isAxiosError: jest.fn(),
});

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

jest.mock('../services/stalker-playback-context.service', () => ({
    rememberStalkerPlaybackContext: jest.fn(),
}));

const PORTAL_URL = 'http://dead-portal.example.com:8080/portal.php';
const PORTAL_ENDPOINT = 'http://dead-portal.example.com:8080';
const MAC_ADDRESS = '00:1A:79:AA:BB:CC';

describe('StalkerEvents host connectivity guard', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let requestHandler: (...args: unknown[]) => unknown;

    /** A host-level failure: the portal never answered. */
    const connectionRefused = () =>
        Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:8080'), {
            code: 'ECONNREFUSED',
        });

    const request = (overrides: Record<string, unknown> = {}) =>
        requestHandler(
            {},
            {
                url: PORTAL_URL,
                macAddress: MAC_ADDRESS,
                params: {
                    type: 'itv',
                    action: 'get_all_channels',
                    JsHttpRequest: '1-xml',
                },
                ...overrides,
            }
        ) as Promise<unknown>;

    beforeEach(async () => {
        jest.resetModules();
        registeredHandlers.clear();
        axiosMock.mockReset();
        axiosMock.isAxiosError.mockReset();
        // Nothing here is an axios error unless a test says so; the handler
        // only needs `code` to classify a connection failure.
        axiosMock.isAxiosError.mockReturnValue(false);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await import('./stalker.events');
        const handler = registeredHandlers.get(STALKER_REQUEST);
        expect(handler).toBeDefined();
        requestHandler = handler as (...args: unknown[]) => unknown;
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    it('holds a live trial beyond 45 seconds and releases a cancelled request', async () => {
        let now = 1_000;
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        let cancel!: (error: Error) => void;
        let arrived!: () => void;
        const pending = new Promise<never>((_, reject) => {
            cancel = reject;
        });
        const started = new Promise<void>((resolve) => {
            arrived = resolve;
        });
        let trial: Promise<unknown> | undefined;
        try {
            axiosMock.mockRejectedValue(connectionRefused());
            await expect(request()).rejects.toBeDefined();
            await expect(request()).rejects.toBeDefined();
            now += 30_001;
            axiosMock.mockImplementationOnce(() => {
                arrived();
                return pending;
            });
            trial = request().catch((error) => error);
            await started;
            now += 45_001;
            await expect(request()).rejects.toThrow(
                buildHostConnectivityFastFailMessage(PORTAL_ENDPOINT)
            );
            expect(axiosMock).toHaveBeenCalledTimes(3);
            cancel(
                Object.assign(new Error('cancelled'), { code: 'ERR_CANCELED' })
            );
            await trial;
            axiosMock.mockResolvedValue({ status: 200, data: [], headers: {} });
            await expect(request()).resolves.toBeDefined();
            expect(axiosMock).toHaveBeenCalledTimes(4);
        } finally {
            cancel(new Error('test cleanup'));
            await trial;
            clock.mockRestore();
        }
    });

    it('releases the trial in finally when debug reporting throws before the outcome report', async () => {
        let now = 1_000;
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        const debug = await import('./portal-debug.events');
        const reportingError = new Error('debug reporting failed');
        try {
            axiosMock.mockRejectedValue(connectionRefused());
            await expect(request()).rejects.toBeDefined();
            await expect(request()).rejects.toBeDefined();
            now += 30_001;
            jest.mocked(debug.emitPortalDebugEvent).mockImplementationOnce(
                () => {
                    throw reportingError;
                }
            );
            await expect(request({ requestId: 'debug-trial' })).rejects.toBe(
                reportingError
            );
            axiosMock.mockResolvedValue({ status: 200, data: [], headers: {} });
            await expect(request()).resolves.toBeDefined();
            expect(axiosMock).toHaveBeenCalledTimes(4);
        } finally {
            jest.mocked(debug.emitPortalDebugEvent).mockReset();
            clock.mockRestore();
        }
    });

    it('stops contacting a portal host that refused twice in a row', async () => {
        axiosMock.mockRejectedValue(connectionRefused());

        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toBeDefined();
        expect(axiosMock).toHaveBeenCalledTimes(2);

        await expect(request()).rejects.toThrow(
            buildHostConnectivityFastFailMessage(PORTAL_ENDPOINT)
        );
        // The whole point: no third 15-second wait.
        expect(axiosMock).toHaveBeenCalledTimes(2);
    });

    it('rejects with a real Error so the renderer keeps its classification', async () => {
        // Electron serializes a rejected plain object to '[object Object]',
        // which would destroy the renderer's timeout-vs-connection reading.
        axiosMock.mockRejectedValue(connectionRefused());
        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toBeDefined();

        await expect(request()).rejects.toBeInstanceOf(Error);
    });

    it('does not log a line per skipped request', async () => {
        axiosMock.mockRejectedValue(connectionRefused());
        await expect(request()).rejects.toBeDefined();
        await expect(request()).rejects.toBeDefined();
        consoleErrorSpy.mockClear();

        await expect(request()).rejects.toBeDefined();

        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('keeps trusting a host that answers, whatever the status is', async () => {
        axiosMock
            .mockRejectedValue(connectionRefused())
            .mockRejectedValueOnce(connectionRefused())
            .mockResolvedValueOnce({
                status: 404,
                statusText: 'Not Found',
                data: {},
                headers: {},
            });

        await expect(request()).rejects.toThrow('ECONNREFUSED');
        // A 404 still proves the host is reachable, so the streak restarts.
        await expect(request()).rejects.toThrow('HTTP Error 404');
        await expect(request()).rejects.toThrow('ECONNREFUSED');

        // Two failures happened in total, but not consecutively.
        await expect(request()).rejects.toThrow('ECONNREFUSED');
        expect(axiosMock).toHaveBeenCalledTimes(4);
    });

    describe('endpoint-discovery probes', () => {
        it('are never fast-failed, because discovery is how a portal gets reclassified', async () => {
            axiosMock.mockRejectedValue(connectionRefused());

            await expect(request()).rejects.toBeDefined();
            await expect(request()).rejects.toBeDefined();
            await expect(request()).rejects.toThrow(
                buildHostConnectivityFastFailMessage(PORTAL_ENDPOINT)
            );

            await expect(
                request({ skipConnectionGuard: true })
            ).rejects.toThrow('ECONNREFUSED');
            expect(axiosMock).toHaveBeenCalledTimes(3);
        });

        it('never count towards the guard', async () => {
            // Discovery walks several candidate paths on one host and expects
            // most of them to fail; counting that would abandon a slow portal.
            axiosMock.mockRejectedValue(connectionRefused());

            await expect(
                request({ skipConnectionGuard: true })
            ).rejects.toBeDefined();
            await expect(
                request({ skipConnectionGuard: true })
            ).rejects.toBeDefined();
            await expect(
                request({ skipConnectionGuard: true })
            ).rejects.toBeDefined();

            await expect(request()).rejects.toThrow('ECONNREFUSED');
            expect(axiosMock).toHaveBeenCalledTimes(4);
        });

        it('clear the record on a 5xx too, not just a body', async () => {
            // 5xx rejects with a response attached. The probe's failure must not
            // count, but the response still proves the origin answered —
            // dropping it is what lets the breaker open mid-discovery.
            const serverError = () =>
                Object.assign(
                    new Error('Request failed with status code 502'),
                    {
                        code: 'ERR_BAD_RESPONSE',
                        response: { status: 502, statusText: 'Bad Gateway' },
                    }
                );
            axiosMock
                .mockRejectedValue(connectionRefused())
                .mockRejectedValueOnce(connectionRefused())
                .mockRejectedValueOnce(serverError())
                .mockRejectedValueOnce(connectionRefused());

            await expect(request()).rejects.toBeDefined();
            await expect(
                request({ skipConnectionGuard: true })
            ).rejects.toBeDefined();
            await expect(request()).rejects.toThrow('ECONNREFUSED');

            // The probe's 5xx reset the streak, so the failure above is the
            // first of a new one and this request still goes out.
            await expect(request()).rejects.toThrow('ECONNREFUSED');
            expect(axiosMock).toHaveBeenCalledTimes(4);
        });

        it('still clear the record when a candidate answers', async () => {
            // Authentication against auth-gated candidates is NOT exempt, so
            // without this the breaker could open in the middle of discovery.
            axiosMock
                .mockRejectedValue(connectionRefused())
                .mockRejectedValueOnce(connectionRefused())
                .mockResolvedValueOnce({
                    status: 200,
                    statusText: 'OK',
                    data: { js: [] },
                    headers: {},
                })
                .mockRejectedValueOnce(connectionRefused());

            await expect(request()).rejects.toBeDefined();
            await expect(
                request({ skipConnectionGuard: true })
            ).resolves.toEqual({ js: [] });
            await expect(request()).rejects.toThrow('ECONNREFUSED');

            // The probe's success reset the streak, so the failure above is the
            // first of a new one and this request still goes out. Without that
            // reset it would be the second, and this would be fast-failed.
            await expect(request()).rejects.toThrow('ECONNREFUSED');
            expect(axiosMock).toHaveBeenCalledTimes(4);
        });
    });
});

describe('StalkerEvents expected outcomes', () => {
    const TRACE_IPC_ENV = 'IPTVNATOR_TRACE_IPC';
    const originalTraceIpc = process.env[TRACE_IPC_ENV];
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;
    let requestHandler: (...args: unknown[]) => unknown;

    /** axios' rejection once the request's abort signal fired. */
    const cancelled = () =>
        Object.assign(new Error('canceled'), {
            code: 'ERR_CANCELED',
            name: 'CanceledError',
        });

    const request = (overrides: Record<string, unknown> = {}) =>
        requestHandler(
            { sender: { id: 7 } },
            {
                url: PORTAL_URL,
                macAddress: MAC_ADDRESS,
                token: 'bearer-secret',
                params: {
                    type: 'stb',
                    action: 'get_profile',
                    JsHttpRequest: '1-xml',
                },
                ...overrides,
            }
        ) as Promise<unknown>;

    const allOutput = () =>
        JSON.stringify([
            ...consoleLogSpy.mock.calls,
            ...consoleWarnSpy.mock.calls,
            ...consoleErrorSpy.mock.calls,
        ]);

    beforeEach(async () => {
        jest.resetModules();
        delete process.env[TRACE_IPC_ENV];
        registeredHandlers.clear();
        axiosMock.mockReset();
        axiosMock.isAxiosError.mockReset();
        axiosMock.isAxiosError.mockImplementation(
            (value: unknown) =>
                !!value && typeof value === 'object' && 'code' in value
        );
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

        await import('./stalker.events');
        requestHandler = registeredHandlers.get(STALKER_REQUEST) as (
            ...args: unknown[]
        ) => unknown;
        expect(requestHandler).toBeDefined();
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleLogSpy.mockRestore();
        if (originalTraceIpc === undefined) {
            delete process.env[TRACE_IPC_ENV];
        } else {
            process.env[TRACE_IPC_ENV] = originalTraceIpc;
        }
    });

    it('resolves a cancelled request as a structured failure, not a rejection and not an answer', async () => {
        axiosMock.mockRejectedValue(cancelled());

        const result = await request({
            probe: { requestId: 'health', deadlineAt: Date.now() + 5000 },
        });

        expect(result).toEqual({ portalRequestFailure: { kind: 'cancelled' } });
        expect(readPortalRequestFailure(result)).toEqual({ kind: 'cancelled' });
        // Nothing a consumer could read as portal data.
        expect(result).not.toHaveProperty('js');
        // Silent: the renderer asked for it.
        expect(allOutput()).toBe('[]');
    });

    it('traces a cancellation only under the IPC trace flag, without the MAC or query', async () => {
        process.env[TRACE_IPC_ENV] = '1';
        axiosMock.mockRejectedValue(cancelled());

        await request();

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const line = String(consoleLogSpy.mock.calls[0][0]);
        expect(line).toContain('[STALKER_REQUEST] cancelled');
        expect(line).toContain('dead-portal.example.com:8080');
        expect(line).not.toContain('00:1A:79');
        expect(line).not.toContain('bearer-secret');
        expect(line).not.toContain('?');
        expect(consoleWarnSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it.each([
        [401, 'Unauthorized'],
        [403, 'Forbidden'],
    ])(
        'resolves HTTP %s as a structured failure with one credential-free warning',
        async (status, statusText) => {
            axiosMock.mockResolvedValue({
                status,
                statusText,
                data: '',
                headers: {},
            });

            await expect(request()).resolves.toEqual({
                portalRequestFailure: { kind: 'http', status, statusText },
            });

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy.mock.calls[0][0]).toBe(
                '[STALKER_REQUEST] Refused'
            );
            expect(consoleWarnSpy.mock.calls[0][1]).toMatchObject({
                action: 'get_profile',
                host: 'dead-portal.example.com:8080',
                pathname: '/portal.php',
                status,
            });
            const output = allOutput();
            expect(output).not.toContain('00:1A:79');
            expect(output).not.toContain('bearer-secret');
            expect(output).not.toContain('portal.php?');
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        }
    );

    it('still rejects a 404 with its status and logs it as an error', async () => {
        // Endpoint discovery reads "probe the next candidate" from this.
        axiosMock.mockResolvedValue({
            status: 404,
            statusText: 'Not Found',
            data: '',
            headers: {},
        });

        await expect(request()).rejects.toThrow('HTTP Error 404: Not Found');
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy.mock.calls[0][0]).toBe(
            '[STALKER_REQUEST] Failed'
        );
        expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it.each([
        [
            'a 5xx',
            Object.assign(new Error('Request failed with status code 502'), {
                code: 'ERR_BAD_RESPONSE',
                response: { status: 502, statusText: 'Bad Gateway' },
            }),
            'HTTP Error 502',
        ],
        [
            'a connection failure',
            Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:8080'), {
                code: 'ECONNREFUSED',
            }),
            'ECONNREFUSED',
        ],
        [
            'a timeout',
            Object.assign(new Error('timeout of 15000ms exceeded'), {
                code: 'ECONNABORTED',
            }),
            'timeout of 15000ms exceeded',
        ],
    ])(
        'still rejects %s and logs it as an error',
        async (_label, error, message) => {
            axiosMock.mockRejectedValue(error);

            await expect(request()).rejects.toThrow(message);
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy.mock.calls[0][0]).toBe(
                '[STALKER_REQUEST] Failed'
            );
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        }
    );
});
