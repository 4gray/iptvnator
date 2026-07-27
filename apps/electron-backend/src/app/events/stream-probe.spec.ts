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

describe('stream probe', () => {
    beforeEach(async () => {
        jest.resetModules();
        registeredHandlers.clear();
        axiosMock.mockReset();
        axiosMock.isAxiosError.mockReset();

        const { registerStreamProbeHandlers } = await import('./stream-probe');
        registerStreamProbeHandlers();
    });

    it('registers both the generic and the legacy Xtream channel', () => {
        expect(registeredHandlers.get('STREAM_PROBE_URL')).toBeDefined();
        // The catchup variant probe still calls the old channel.
        expect(registeredHandlers.get('XTREAM_PROBE_URL')).toBeDefined();
    });

    it('defaults to HEAD and reports latency', async () => {
        const probeHandler = registeredHandlers.get('STREAM_PROBE_URL');
        axiosMock.mockImplementation((config: { url?: string }) =>
            Promise.resolve({ status: 200, headers: {}, config })
        );

        const result = (await probeHandler?.(
            {},
            { url: 'http://example.com/movie.mkv' }
        )) as { status: number; latencyMs?: number };

        expect(result.status).toBe(200);
        expect(typeof result.latencyMs).toBe('number');
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);

        const request = axiosMock.mock.calls[0][0] as {
            method?: string;
            headers?: Record<string, string>;
            responseType?: string;
        };
        expect(request.method).toBe('HEAD');
        // No Range header on HEAD — that is only the GET fallback's job.
        expect(request.headers?.['Range']).toBeUndefined();
        expect(request.responseType).toBeUndefined();
    });

    it('follows validated redirects for range GET media probes', async () => {
        const probeHandler = registeredHandlers.get('STREAM_PROBE_URL');
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
        expect(firstRequest.headers?.['User-Agent']).not.toBe(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        );
        expect(firstRequest.maxRedirects).toBe(0);
        expect(firstRequest.responseType).toBe('stream');
        // The ranged GET opens a stream nobody reads — it must be released.
        expect(destroyProbeBody).toHaveBeenCalledTimes(1);
    });

    it('rejects private cross-origin redirects for range GET media probes', async () => {
        const probeHandler = registeredHandlers.get('STREAM_PROBE_URL');
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

        // A policy rejection carries no latency: it never left the process,
        // and callers must be able to tell it apart from a real timing.
        expect(result).toEqual({
            error: 'URL points to a private or local network address',
            status: 0,
            url: 'http://localhost:3211/streaming/timeshift.php?stream=45',
        });
        expect(axiosMock).toHaveBeenCalledTimes(1);
    });

    it('reports a refusal status rather than treating it as unreachable', async () => {
        const probeHandler = registeredHandlers.get('STREAM_PROBE_URL');
        const refusal = Object.assign(new Error('forbidden'), {
            response: { status: 403 },
        });
        axiosMock.mockRejectedValueOnce(refusal);
        axiosMock.isAxiosError.mockImplementation(
            (error: unknown) => error === refusal
        );

        const result = (await probeHandler?.(
            {},
            { url: 'http://example.com/movie.mkv' }
        )) as { status: number; latencyMs?: number };

        // 403 answers "is anything there" — it is a fact, not a failure to check.
        expect(result.status).toBe(403);
        expect(typeof result.latencyMs).toBe('number');
    });

    it('returns status 0 without latency when no response is obtained', async () => {
        const probeHandler = registeredHandlers.get('STREAM_PROBE_URL');
        axiosMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
        axiosMock.isAxiosError.mockReturnValue(false);

        const result = (await probeHandler?.(
            {},
            { url: 'http://example.com/movie.mkv' }
        )) as { status: number; url: string; latencyMs?: number };

        expect(result).toEqual({
            status: 0,
            url: 'http://example.com/movie.mkv',
        });
    });
});
