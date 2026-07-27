import type {
    AxiosRequestConfig,
    AxiosResponseHeaders,
    AxiosResponseTransformer,
    InternalAxiosRequestConfig,
} from 'axios';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
export const mockParseTransform = jest.fn(function (data: unknown) {
    return typeof data === 'string' ? JSON.parse(data) : data;
});
export const mockFinalizeTransform = jest.fn(function (data: unknown) {
    return data;
});
const mockDefaultTransforms: AxiosResponseTransformer[] = [
    mockParseTransform,
    mockFinalizeTransform,
];
let mockDefaultsReadCount = 0;
export const axiosMock = Object.assign(jest.fn(), {
    isAxiosError: jest.fn(),
});
Object.defineProperty(axiosMock, 'defaults', {
    configurable: true,
    get: () => {
        mockDefaultsReadCount += 1;
        return { transformResponse: mockDefaultTransforms };
    },
});

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(
            (name: string, handler: (...args: unknown[]) => unknown) => {
                registeredHandlers.set(name, handler);
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

export function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

export function applyConfiguredTransforms(
    config: AxiosRequestConfig,
    data: unknown,
    status: number
): unknown {
    const configured = config.transformResponse;
    if (!configured) {
        return data;
    }
    const headers = {
        normalize: jest.fn(function () {
            return this;
        }),
    } as unknown as AxiosResponseHeaders & {
        normalize: () => AxiosResponseHeaders;
    };
    const transforms = Array.isArray(configured) ? configured : [configured];
    let transformed = data;
    for (const transform of transforms) {
        transformed = transform.call(
            config as InternalAxiosRequestConfig,
            transformed,
            headers.normalize(),
            status
        );
    }
    headers.normalize();
    return transformed;
}

export async function loadXtreamEvents(
    captureValue: string | undefined
): Promise<void> {
    jest.resetModules();
    registeredHandlers.clear();
    axiosMock.mockReset();
    axiosMock.isAxiosError.mockReset();
    mockParseTransform.mockClear();
    mockFinalizeTransform.mockClear();
    mockDefaultsReadCount = 0;
    if (captureValue === undefined) {
        delete process.env['IPTVNATOR_PERF_CAPTURE'];
    } else {
        process.env['IPTVNATOR_PERF_CAPTURE'] = captureValue;
    }
    await import('./xtream.events');
}

export function getHandler(name: string): (...args: unknown[]) => unknown {
    const handler = registeredHandlers.get(name);
    if (!handler) {
        throw new Error(`Missing IPC handler: ${name}`);
    }
    return handler;
}

export function getDefaultsReadCount(): number {
    return mockDefaultsReadCount;
}
