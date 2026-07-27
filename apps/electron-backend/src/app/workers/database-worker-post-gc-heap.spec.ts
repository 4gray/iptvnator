import { once } from 'node:events';
import { getHeapStatistics } from 'node:v8';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import {
    DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON,
    handleDatabaseWorkerPostGcHeapRequest,
    isDatabaseWorkerPostGcHeapRequest,
    type DatabaseWorkerPostGcHeapRequest,
    type DatabaseWorkerPostGcHeapResult,
} from './database-worker-post-gc-heap';

jest.mock('node:v8', () => ({
    getHeapStatistics: jest.fn(),
}));

const PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';
const mockedGetHeapStatistics = getHeapStatistics as jest.MockedFunction<
    typeof getHeapStatistics
>;

type FakeResponsePort = {
    close: jest.Mock<void, []>;
    messages: DatabaseWorkerPostGcHeapResult[];
    port: MessagePort;
    postMessage: jest.Mock<void, [DatabaseWorkerPostGcHeapResult]>;
};

function createFakeResponsePort(): FakeResponsePort {
    const messages: DatabaseWorkerPostGcHeapResult[] = [];
    const close = jest.fn<void, []>();
    const postMessage = jest.fn<void, [DatabaseWorkerPostGcHeapResult]>(
        (message) => {
            messages.push(message);
        }
    );

    return {
        close,
        messages,
        port: {
            close,
            postMessage,
        } as unknown as MessagePort,
        postMessage,
    };
}

function handleWithFakePort(isIdle: boolean): {
    gc: jest.Mock<void, []> | null;
    responsePort: FakeResponsePort;
} {
    const responsePort = createFakeResponsePort();
    const gcCandidate = Reflect.get(globalThis, 'gc');
    const request: DatabaseWorkerPostGcHeapRequest = {
        type: 'performance:collect-post-gc-heap',
        responsePort: responsePort.port,
    };

    handleDatabaseWorkerPostGcHeapRequest(request, isIdle);

    return {
        gc:
            typeof gcCandidate === 'function'
                ? (gcCandidate as unknown as jest.Mock<void, []>)
                : null,
        responsePort,
    };
}

describe('database worker post-GC heap capture', () => {
    const originalProfilingValue = process.env[PROFILING_ENV];
    const originalGc = Reflect.get(globalThis, 'gc');

    beforeEach(() => {
        process.env[PROFILING_ENV] = '1';
        Reflect.set(globalThis, 'gc', jest.fn<void, []>());
        mockedGetHeapStatistics.mockReset();
        mockedGetHeapStatistics.mockReturnValue({
            used_heap_size: 42_000,
        } as ReturnType<typeof getHeapStatistics>);
    });

    afterAll(() => {
        if (originalProfilingValue === undefined) {
            delete process.env[PROFILING_ENV];
        } else {
            process.env[PROFILING_ENV] = originalProfilingValue;
        }

        if (originalGc === undefined) {
            Reflect.deleteProperty(globalThis, 'gc');
        } else {
            Reflect.set(globalThis, 'gc', originalGc);
        }
    });

    it('recognizes only the exact request with a real MessagePort', () => {
        const { port1, port2 } = new MessageChannel();

        try {
            expect(
                isDatabaseWorkerPostGcHeapRequest({
                    type: 'performance:collect-post-gc-heap',
                    responsePort: port2,
                })
            ).toBe(true);
            expect(isDatabaseWorkerPostGcHeapRequest(null)).toBe(false);
            expect(
                isDatabaseWorkerPostGcHeapRequest({
                    type: 'performance:collect-post-gc-heap',
                })
            ).toBe(false);
            expect(
                isDatabaseWorkerPostGcHeapRequest({
                    type: 'performance:collect-post-gc-heap',
                    responsePort: {
                        close: jest.fn(),
                        postMessage: jest.fn(),
                    },
                })
            ).toBe(false);
            expect(
                isDatabaseWorkerPostGcHeapRequest({
                    type: 'request',
                    responsePort: port2,
                })
            ).toBe(false);
        } finally {
            port1.close();
            port2.close();
        }
    });

    it('forces GC before reading and returning the worker V8 heap', async () => {
        const lifecycle: string[] = [];
        const { port1, port2 } = new MessageChannel();
        Reflect.set(
            globalThis,
            'gc',
            jest.fn(() => lifecycle.push('gc'))
        );
        mockedGetHeapStatistics.mockImplementation(() => {
            lifecycle.push('heap');
            return {
                used_heap_size: 73_728,
            } as ReturnType<typeof getHeapStatistics>;
        });
        const responsePromise = once(port1, 'message') as Promise<
            [DatabaseWorkerPostGcHeapResult]
        >;
        const peerClosedPromise = once(port1, 'close');

        handleDatabaseWorkerPostGcHeapRequest(
            {
                type: 'performance:collect-post-gc-heap',
                responsePort: port2,
            },
            true
        );

        await expect(responsePromise).resolves.toEqual([
            {
                type: 'performance:post-gc-heap-result',
                postGcHeapUsedBytes: 73_728,
                unavailableReason: null,
            },
        ]);
        await peerClosedPromise;
        expect(lifecycle).toEqual(['gc', 'heap']);
    });

    it('fails closed without profiling opt-in', () => {
        delete process.env[PROFILING_ENV];

        const { gc, responsePort } = handleWithFakePort(true);

        expect(gc).not.toHaveBeenCalled();
        expect(mockedGetHeapStatistics).not.toHaveBeenCalled();
        expect(responsePort.messages).toEqual([
            {
                type: 'performance:post-gc-heap-result',
                postGcHeapUsedBytes: null,
                unavailableReason:
                    DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.PROFILING_DISABLED,
            },
        ]);
        expect(responsePort.postMessage).toHaveBeenCalledTimes(1);
        expect(responsePort.close).toHaveBeenCalledTimes(1);
    });

    it('does not perturb an active database operation', () => {
        const { gc, responsePort } = handleWithFakePort(false);

        expect(gc).not.toHaveBeenCalled();
        expect(mockedGetHeapStatistics).not.toHaveBeenCalled();
        expect(responsePort.messages).toEqual([
            {
                type: 'performance:post-gc-heap-result',
                postGcHeapUsedBytes: null,
                unavailableReason:
                    DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.WORKER_BUSY,
            },
        ]);
        expect(responsePort.postMessage).toHaveBeenCalledTimes(1);
        expect(responsePort.close).toHaveBeenCalledTimes(1);
    });

    it('reports an unavailable exposed-GC runtime without reading heap statistics', () => {
        Reflect.deleteProperty(globalThis, 'gc');

        const { responsePort } = handleWithFakePort(true);

        expect(mockedGetHeapStatistics).not.toHaveBeenCalled();
        expect(responsePort.messages).toEqual([
            {
                type: 'performance:post-gc-heap-result',
                postGcHeapUsedBytes: null,
                unavailableReason:
                    DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.GC_UNAVAILABLE,
            },
        ]);
        expect(responsePort.postMessage).toHaveBeenCalledTimes(1);
        expect(responsePort.close).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['negative', -1],
        ['fractional', 1.5],
        ['NaN', Number.NaN],
        ['infinite', Number.POSITIVE_INFINITY],
        ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects a %s heap measurement', (_label, usedHeapSize) => {
        mockedGetHeapStatistics.mockReturnValue({
            used_heap_size: usedHeapSize,
        } as ReturnType<typeof getHeapStatistics>);

        const { gc, responsePort } = handleWithFakePort(true);

        expect(gc).toHaveBeenCalledTimes(1);
        expect(mockedGetHeapStatistics).toHaveBeenCalledTimes(1);
        expect(responsePort.messages).toEqual([
            {
                type: 'performance:post-gc-heap-result',
                postGcHeapUsedBytes: null,
                unavailableReason:
                    DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.CAPTURE_FAILED,
            },
        ]);
        expect(responsePort.postMessage).toHaveBeenCalledTimes(1);
        expect(responsePort.close).toHaveBeenCalledTimes(1);
    });

    it.each(['gc', 'heap'] as const)(
        'reports capture failure when %s collection throws',
        (failurePoint) => {
            if (failurePoint === 'gc') {
                Reflect.set(
                    globalThis,
                    'gc',
                    jest.fn(() => {
                        throw new Error('gc failed');
                    })
                );
            } else {
                mockedGetHeapStatistics.mockImplementation(() => {
                    throw new Error('heap failed');
                });
            }

            const { responsePort } = handleWithFakePort(true);

            expect(responsePort.messages).toEqual([
                {
                    type: 'performance:post-gc-heap-result',
                    postGcHeapUsedBytes: null,
                    unavailableReason:
                        DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.CAPTURE_FAILED,
                },
            ]);
            expect(responsePort.postMessage).toHaveBeenCalledTimes(1);
            expect(responsePort.close).toHaveBeenCalledTimes(1);
        }
    );

    it('still closes the one-shot port when posting the result fails', () => {
        const responsePort = createFakeResponsePort();
        responsePort.postMessage.mockImplementation(() => {
            throw new Error('port closed');
        });

        expect(() =>
            handleDatabaseWorkerPostGcHeapRequest(
                {
                    type: 'performance:collect-post-gc-heap',
                    responsePort: responsePort.port,
                },
                true
            )
        ).not.toThrow();
        expect(responsePort.postMessage).toHaveBeenCalledTimes(1);
        expect(responsePort.close).toHaveBeenCalledTimes(1);
    });
});
