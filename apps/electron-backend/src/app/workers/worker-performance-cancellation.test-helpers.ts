type WorkerMessageHandler<TMessage> = (
    message: TMessage
) => Promise<void> | void;

export interface ArmGate {
    readonly promise: Promise<void>;
    readonly release: () => void;
}

export const WORKER_PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';

const originalWorkerProfilingValue = process.env[WORKER_PROFILING_ENV];

export function restoreWorkerProfilingEnvironment(): void {
    if (originalWorkerProfilingValue === undefined) {
        delete process.env[WORKER_PROFILING_ENV];
    } else {
        process.env[WORKER_PROFILING_ENV] = originalWorkerProfilingValue;
    }
}

export function createArmGate(): ArmGate {
    let release = (): void => undefined;
    const promise = new Promise<void>((resolvePromise) => {
        release = resolvePromise;
    });
    return { promise, release };
}

export function createParentPortHarness<TIncoming, TOutgoing>() {
    let messageHandler: WorkerMessageHandler<TIncoming> | null = null;
    const postMessage = jest.fn<void, [TOutgoing]>();
    const parentPort = {
        on: jest.fn(
            (event: string, handler: WorkerMessageHandler<TIncoming>): void => {
                if (event === 'message') {
                    messageHandler = handler;
                }
            }
        ),
        postMessage,
    };

    return {
        getMessageHandler: (): WorkerMessageHandler<TIncoming> => {
            if (!messageHandler) {
                throw new Error('Worker message handler was not registered');
            }
            return messageHandler;
        },
        parentPort,
        postMessage,
    };
}

export function mockPerformanceCapture(
    armGate: ArmGate,
    failureGates?: {
        readonly observed: ArmGate;
        readonly profilingFinished: ArmGate;
    },
    capture: unknown = {}
): void {
    jest.doMock('./worker-performance-capture', () => ({
        armWorkerPerformanceCapture: jest.fn(() => armGate.promise),
        executeWithWorkerPerformanceCapture: jest.fn(
            async (_capture: unknown, execute: () => Promise<unknown>) => {
                try {
                    return {
                        error: null,
                        performance: undefined,
                        result: await execute(),
                        success: true,
                    };
                } catch (error) {
                    failureGates?.observed.release();
                    await failureGates?.profilingFinished.promise;
                    return {
                        error,
                        performance: undefined,
                        result: undefined,
                        success: false,
                    };
                }
            }
        ),
        registerDatabaseWorkerPerformanceCapture: jest.fn(),
        releaseDatabaseWorkerPerformanceCapture: jest.fn(),
        stampWorkerPerformanceResponsePostedEpoch: jest.fn(
            (_capture: unknown, performance: unknown) => performance
        ),
        startWorkerPerformanceCapture: jest.fn(() => capture),
    }));
}
