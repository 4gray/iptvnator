import {
    STALKER_REQUEST,
    buildHostConnectivityFastFailMessage,
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
