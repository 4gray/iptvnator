import {
    WORKER_PERFORMANCE_INVALID_REASON,
    armWorkerPerformanceCapture,
    executeWithWorkerPerformanceCapture,
    registerDatabaseWorkerPerformanceCapture,
    releaseDatabaseWorkerPerformanceCapture,
    startWorkerPerformanceCapture,
    type WorkerPerformanceCapture,
    type WorkerPerformanceCaptureRuntime,
} from './worker-performance-capture';
import { DEFAULT_WORKER_PERFORMANCE_RUNTIME } from './worker-performance-capture.runtime';
import { createFakeRuntime } from './worker-performance-capture.test-harness';

const PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';

const BLOCK_DURATION_MS = 20;
const REAL_TIMER_TEST_TIMEOUT_MS = 30_000;

/**
 * `monitorEventLoopDelay()` records nothing on its first internal timer tick —
 * that tick only seeds the previous timestamp, so the first delay sample lands
 * on the second tick. Condition-based arming therefore needs two event-loop
 * turns, and it budgets for them with a 50ms deadline read from
 * `readMonotonicMs()`. A machine running the full Jest suite in parallel can
 * stretch a single turn past 20ms, so that deadline expires against the
 * scheduler rather than against any defect in the capture code.
 *
 * Slowing only that deadline clock leaves the wait bounded by its other limit,
 * the 50-poll ceiling, which is ~25x the two turns arming actually needs.
 * Everything else stays production code: the real `monitorEventLoopDelay()`
 * histogram, real `setTimeout()` polling, and real epoch/CPU/ELU boundaries.
 * The scaled clock reaches nothing but the wait budgets — its only other
 * consumer records phase events, and this spec records none.
 */
const WAIT_DEADLINE_CLOCK_SCALE = 50;

function createRuntimeWithScaledWaitDeadline(): WorkerPerformanceCaptureRuntime {
    return {
        ...DEFAULT_WORKER_PERFORMANCE_RUNTIME,
        readMonotonicMs: () =>
            DEFAULT_WORKER_PERFORMANCE_RUNTIME.readMonotonicMs() /
            WAIT_DEADLINE_CLOCK_SCALE,
    };
}

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

    it(
        'measures a real 20ms event-loop block through condition-based arming',
        async () => {
            process.env[PROFILING_ENV] = '1';

            // No `enabled` override: the env variable is the opt-in under test.
            const capture = startWorkerPerformanceCapture({
                runtime: createRuntimeWithScaledWaitDeadline(),
            });

            expect(capture).not.toBeNull();

            await armWorkerPerformanceCapture(capture);
            const execution = await executeWithWorkerPerformanceCapture(
                capture,
                async () => {
                    const blockStartedAt = performance.now();
                    while (
                        performance.now() - blockStartedAt <
                        BLOCK_DURATION_MS
                    ) {
                        // This deliberate block is the behavior under measurement.
                    }
                }
            );

            expect(execution.success).toBe(true);
            expect(execution.performance?.invalidReason).toBeNull();
            expect(
                execution.performance?.eventLoopDelayUnavailableReason
            ).toBeNull();
            expect(
                execution.performance?.histogramFlushedEpochMs
            ).not.toBeNull();
            expect(
                execution.performance?.eventLoopDelay?.maxMs
            ).toBeGreaterThan(10);
        },
        REAL_TIMER_TEST_TIMEOUT_MS
    );
});
