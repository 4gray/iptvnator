import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type {
    DbOperationEvent,
    DbWorkerIncomingMessage,
    DbWorkerMessage,
    DbWorkerResponseMessage,
} from './database-worker.types';

/**
 * Pins the worker-side wiring of `operation-progress-throttle.ts`: reports
 * arriving inside the throttle interval are coalesced, and whatever is still
 * pending is emitted before the terminal event, so a consumer summing
 * `increment` never ends up short of the rows that actually landed.
 */

const BATCH_DELAY_ENV = 'IPTVNATOR_DB_WORKER_BATCH_DELAY_MS';
const WORKER_PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';
const originalBatchDelay = process.env[BATCH_DELAY_ENV];
const originalWorkerProfiling = process.env[WORKER_PROFILING_ENV];

type ProgressControl = {
    checkpoint: () => Promise<void>;
    onProgress: (progress: {
        phase: string;
        current: number;
        total: number;
        increment: number;
    }) => Promise<void>;
};

function restoreEnvironment(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

describe('database worker progress throttle wiring', () => {
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

    /**
     * Boots the worker against a `saveContent` stand-in that drives the
     * operation control however the test wants, and returns every message the
     * worker posts plus its final response.
     */
    async function runSaveContent(
        drive: (control: ProgressControl) => Promise<void>
    ): Promise<{
        events: DbOperationEvent[];
        response: DbWorkerResponseMessage;
    }> {
        delete process.env[BATCH_DELAY_ENV];
        delete process.env[WORKER_PROFILING_ENV];

        const channel = new MessageChannel();
        workerPort = channel.port1;
        clientPort = channel.port2;
        const events: DbOperationEvent[] = [];
        let settleResponse!: (response: DbWorkerResponseMessage) => void;
        const responsePromise = new Promise<DbWorkerResponseMessage>(
            (resolve) => {
                settleResponse = resolve;
            }
        );

        clientPort.on('message', (message: DbWorkerMessage) => {
            if (message.type === 'event') {
                events.push(message.event);
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
                    control: ProgressControl
                ) => {
                    await drive(control);
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
        const request: DbWorkerIncomingMessage = {
            type: 'request',
            operation: 'DB_SAVE_CONTENT',
            payload: {
                operationId: 'operation-throttle',
                playlistId: 'playlist-1',
                streams: [{ stream_id: 1 }],
                type: 'live',
            },
            requestId: 'request-throttle',
        };
        clientPort.postMessage(request);

        return { events, response: await responsePromise };
    }

    const report = (current: number) => ({
        phase: 'saving-content',
        current,
        total: 10,
        increment: 1,
    });

    it('coalesces reports inside the interval and flushes the rest before completed', async () => {
        const { events, response } = await runSaveContent(async (control) => {
            // Three back-to-back reports land inside one 100 ms window and
            // none of them reaches the total, so only the first may pass on
            // its own; the other two must ride on the flush.
            await control.onProgress(report(1));
            await control.onProgress(report(2));
            await control.onProgress(report(3));
        });

        expect(response).toEqual(
            expect.objectContaining({
                requestId: 'request-throttle',
                success: true,
                type: 'response',
            })
        );
        const progress = events.filter((event) => event.status === 'progress');
        expect(
            progress.map(({ current, increment }) => ({ current, increment }))
        ).toEqual([
            { current: 1, increment: 1 },
            { current: 3, increment: 2 },
        ]);
        expect(
            progress.reduce((sum, event) => sum + (event.increment ?? 0), 0)
        ).toBe(3);
        expect(events.map((event) => event.status)).toEqual([
            'started',
            'progress',
            'progress',
            'completed',
        ]);
        // The terminal event inherits the flushed `current`; its `total` is
        // the saved count the save-content case supplies itself.
        expect(events.at(-1)).toEqual(
            expect.objectContaining({
                current: 3,
                operationId: 'operation-throttle',
                status: 'completed',
            })
        );
    });

    it('flushes the pending report before a cancelled event too', async () => {
        const { events, response } = await runSaveContent(async (control) => {
            await control.onProgress(report(1));
            await control.onProgress(report(2));
            const abort = new Error('cancelled between commits');
            abort.name = 'AbortError';
            throw abort;
        });

        expect(response).toEqual(
            expect.objectContaining({
                error: expect.objectContaining({ name: 'AbortError' }),
                success: false,
            })
        );
        expect(
            events.map(({ status, current, increment }) => ({
                status,
                current,
                increment,
            }))
        ).toEqual([
            { status: 'started', current: 0, increment: undefined },
            { status: 'progress', current: 1, increment: 1 },
            { status: 'progress', current: 2, increment: 1 },
            { status: 'cancelled', current: 2, increment: undefined },
        ]);
    });
});
