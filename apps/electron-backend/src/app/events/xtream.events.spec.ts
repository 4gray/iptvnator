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
