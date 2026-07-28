import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type {
    DbWorkerIncomingMessage,
    DbWorkerMessage,
    DbWorkerResponseMessage,
} from './database-worker.types';

const BATCH_DELAY_ENV = 'IPTVNATOR_DB_WORKER_BATCH_DELAY_MS';
const WORKER_PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';
const originalBatchDelay = process.env[BATCH_DELAY_ENV];
const originalWorkerProfiling = process.env[WORKER_PROFILING_ENV];

function restoreEnvironment(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

function postWorkerMessage(
    port: MessagePort,
    message: DbWorkerIncomingMessage
): void {
    port.postMessage(message);
}

describe('database worker zero-delay cancellation', () => {
    let workerPort: MessagePort | null = null;
    let clientPort: MessagePort | null = null;

    afterEach(() => {
        workerPort?.close();
        clientPort?.close();
        workerPort = null;
        clientPort = null;
        restoreEnvironment(BATCH_DELAY_ENV, originalBatchDelay);
        restoreEnvironment(WORKER_PROFILING_ENV, originalWorkerProfiling);
        jest.restoreAllMocks();
        jest.resetModules();
    });

    it('processes cancel posted from progress before the default-delay operation completes', async () => {
        delete process.env[BATCH_DELAY_ENV];
        delete process.env[WORKER_PROFILING_ENV];

        const channel = new MessageChannel();
        workerPort = channel.port1;
        clientPort = channel.port2;
        const messages: DbWorkerMessage[] = [];
        let cancelPosted = false;
        let settleResponse!: (response: DbWorkerResponseMessage) => void;
        const responsePromise = new Promise<DbWorkerResponseMessage>(
            (resolve) => {
                settleResponse = resolve;
            }
        );

        clientPort.on('message', (message: DbWorkerMessage) => {
            messages.push(message);

            if (
                !cancelPosted &&
                message.type === 'event' &&
                message.event.status === 'progress'
            ) {
                cancelPosted = true;
                postWorkerMessage(clientPort!, {
                    type: 'cancel',
                    operationId: 'operation-zero-delay',
                });
            }

            if (message.type === 'response') {
                settleResponse(message);
            }
        });

        jest.doMock('worker_threads', () => ({
            ...jest.requireActual('worker_threads'),
            parentPort: workerPort,
        }));
        jest.doMock('./database.worker-connection', () => ({
            closeWorkerDatabase: jest.fn(),
            getWorkerDatabase: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../database/operations/content.operations', () => ({
            saveContent: jest.fn(
                async (
                    _db: unknown,
                    _playlistId: string,
                    _streams: unknown[],
                    _type: string,
                    control: {
                        checkpoint: () => Promise<void>;
                        onProgress: (progress: {
                            phase: string;
                            current: number;
                            total: number;
                        }) => Promise<void>;
                    }
                ) => {
                    for (let current = 1; current <= 3; current += 1) {
                        await control.checkpoint();
                        await control.onProgress({
                            phase: 'saving-content',
                            current,
                            total: 3,
                        });
                    }
                    return { count: 3, success: true };
                }
            ),
        }));
        jest.doMock('./worker-performance-capture', () => ({
            armWorkerPerformanceCapture: jest.fn(),
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
            startWorkerPerformanceCapture: jest.fn(() => null),
        }));
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await import('./database.worker');
        postWorkerMessage(clientPort, {
            type: 'request',
            operation: 'DB_SAVE_CONTENT',
            payload: {
                operationId: 'operation-zero-delay',
                playlistId: 'playlist-1',
                streams: [{ stream_id: 1 }, { stream_id: 2 }],
                type: 'live',
            },
            requestId: 'request-zero-delay',
        });

        const response = await responsePromise;

        expect(cancelPosted).toBe(true);
        expect(messages).toContainEqual(
            expect.objectContaining({
                event: expect.objectContaining({
                    operationId: 'operation-zero-delay',
                    status: 'cancelled',
                }),
                requestId: 'request-zero-delay',
                type: 'event',
            })
        );
        expect(response).toEqual(
            expect.objectContaining({
                error: expect.objectContaining({ name: 'AbortError' }),
                requestId: 'request-zero-delay',
                success: false,
                type: 'response',
            })
        );
    });
});
