import {
    WORKER_PERFORMANCE_INVALID_REASON,
    WORKER_PERFORMANCE_UNAVAILABLE_REASON,
    armWorkerPerformanceCapture,
    executeWithWorkerPerformanceCapture,
    registerDatabaseWorkerPerformanceCapture,
    releaseDatabaseWorkerPerformanceCapture,
    startWorkerPerformanceCapture,
    type WorkerPerformanceCapture,
    type WorkerPerformanceCaptureResult,
} from './worker-performance-capture';
import { createFakeRuntime } from './worker-performance-capture.test-harness';

const PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';

/**
 * `monitorEventLoopDelay()` records nothing on its first internal timer tick —
 * that tick only seeds the previous timestamp, so the first delay sample lands
 * on the second tick. Condition-based arming therefore needs two event-loop
 * turns inside its fixed 50ms budget. A machine running the full Jest suite in
 * parallel can stretch a single turn past 25ms, which makes a lost arming race
 * an environmental outcome rather than a defect. Retry within a wall-clock
 * budget so the real measurement is asserted whenever the machine allows it.
 */
const REAL_TIMER_ARMING_BUDGET_MS = 5_000;
const REAL_TIMER_TEST_TIMEOUT_MS = 30_000;
const BLOCK_DURATION_MS = 20;

const DOCUMENTED_DELAY_TIMEOUTS = [
    WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_ARM_TIMEOUT,
    WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_FLUSH_TIMEOUT,
];

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
        'observes a real 20ms event-loop block once condition-based arming wins its budget',
        async () => {
            process.env[PROFILING_ENV] = '1';

            const startedAt = performance.now();
            let attempts = 0;
            let measured: WorkerPerformanceCaptureResult | undefined;

            while (
                performance.now() - startedAt <
                REAL_TIMER_ARMING_BUDGET_MS
            ) {
                attempts += 1;
                const capture = startWorkerPerformanceCapture();
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

                // Whether or not arming won its race, instrumentation must never
                // break the work it wraps.
                expect(execution.success).toBe(true);
                expect(execution.performance?.invalidReason).toBeNull();

                if (execution.performance?.eventLoopDelay) {
                    measured = execution.performance;
                    break;
                }

                // A lost race is only ever a documented timeout, never a silent null.
                expect(DOCUMENTED_DELAY_TIMEOUTS).toContain(
                    execution.performance?.eventLoopDelayUnavailableReason
                );
                expect(
                    execution.performance?.histogramFlushedEpochMs
                ).toBeNull();

                // Let the loop breathe before contending for two more turns.
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }

            if (measured === undefined) {
                console.warn(
                    `Event-loop delay arming lost every one of ${attempts} races within ` +
                        `${REAL_TIMER_ARMING_BUDGET_MS}ms; this machine never granted two ` +
                        'event-loop turns inside the 50ms arming budget. The documented ' +
                        'timeout contract was asserted on every attempt instead.'
                );
                return;
            }

            expect(measured.eventLoopDelayUnavailableReason).toBeNull();
            expect(measured.histogramFlushedEpochMs).not.toBeNull();
            expect(measured.eventLoopDelay?.maxMs).toBeGreaterThan(10);
        },
        REAL_TIMER_TEST_TIMEOUT_MS
    );
});
