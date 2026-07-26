import {
    WORKER_PERFORMANCE_INVALID_REASON,
    armWorkerPerformanceCapture,
    executeWithWorkerPerformanceCapture,
    registerDatabaseWorkerPerformanceCapture,
    releaseDatabaseWorkerPerformanceCapture,
    startWorkerPerformanceCapture,
    type WorkerPerformanceCapture,
} from './worker-performance-capture';
import { createFakeRuntime } from './worker-performance-capture.test-harness';

const PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';

describe('worker performance capture concurrency and real timers', () => {
    const originalProfilingValue = process.env[PROFILING_ENV];

    afterEach(() => {
        if (originalProfilingValue === undefined) {
            delete process.env[PROFILING_ENV];
        } else {
            process.env[PROFILING_ENV] = originalProfilingValue;
        }
    });

    it('fails every overlapping database request capture closed without serializing execution', async () => {
        const activeCaptures = new Set<WorkerPerformanceCapture>();
        const firstHarness = createFakeRuntime();
        const secondHarness = createFakeRuntime();
        const first = startWorkerPerformanceCapture({
            enabled: true,
            runtime: firstHarness.runtime,
        });
        const second = startWorkerPerformanceCapture({
            enabled: true,
            runtime: secondHarness.runtime,
        });
        registerDatabaseWorkerPerformanceCapture(activeCaptures, first);
        registerDatabaseWorkerPerformanceCapture(activeCaptures, second);
        await Promise.all([
            armWorkerPerformanceCapture(first),
            armWorkerPerformanceCapture(second),
        ]);

        const [firstExecution, secondExecution] = await Promise.all([
            executeWithWorkerPerformanceCapture(first, async () => 'first'),
            executeWithWorkerPerformanceCapture(second, async () => 'second'),
        ]);
        releaseDatabaseWorkerPerformanceCapture(activeCaptures, first);
        releaseDatabaseWorkerPerformanceCapture(activeCaptures, second);

        for (const execution of [firstExecution, secondExecution]) {
            expect(execution.performance).toMatchObject({
                eventLoopDelay: null,
                eventLoopDelayUnavailableReason:
                    WORKER_PERFORMANCE_INVALID_REASON.OVERLAPPING_DATABASE_WORKER_REQUESTS,
                eventLoopUtilization: null,
                eventLoopUtilizationUnavailableReason:
                    WORKER_PERFORMANCE_INVALID_REASON.OVERLAPPING_DATABASE_WORKER_REQUESTS,
                histogramFlushedEpochMs: null,
                invalidReason:
                    WORKER_PERFORMANCE_INVALID_REASON.OVERLAPPING_DATABASE_WORKER_REQUESTS,
                threadCpuSystemMicros: null,
                threadCpuUnavailableReason:
                    WORKER_PERFORMANCE_INVALID_REASON.OVERLAPPING_DATABASE_WORKER_REQUESTS,
                threadCpuUserMicros: null,
            });
        }
        expect(firstExecution.result).toBe('first');
        expect(secondExecution.result).toBe('second');
        expect(activeCaptures.size).toBe(0);
    });

    it('reliably observes a real 20ms event-loop block after condition-based arming', async () => {
        process.env[PROFILING_ENV] = '1';

        const capture = startWorkerPerformanceCapture();
        await armWorkerPerformanceCapture(capture);
        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => {
                const blockStartedAt = performance.now();
                while (performance.now() - blockStartedAt < 20) {
                    // This deliberate block is the behavior under measurement.
                }
            }
        );

        expect(execution.success).toBe(true);
        expect(execution.performance?.eventLoopDelay).not.toBeNull();
        expect(execution.performance?.eventLoopDelay?.maxMs).toBeGreaterThan(
            10
        );
        expect(execution.performance?.histogramFlushedEpochMs).not.toBeNull();
    });
});
