import {
    WORKER_PERFORMANCE_UNAVAILABLE_REASON,
    armWorkerPerformanceCapture,
    executeWithWorkerPerformanceCapture,
    startWorkerPerformanceCapture,
} from './worker-performance-capture';
import { createFakeRuntime } from './worker-performance-capture.test-harness';

const PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';

/**
 * Capture must never change the business result. These cases drive the
 * monotonic-clock timeouts and every runtime callback that can throw, and
 * assert the awaited value survives each one.
 */
describe('worker performance capture resilience', () => {
    const originalProfilingValue = process.env[PROFILING_ENV];

    afterEach(() => {
        if (originalProfilingValue === undefined) {
            delete process.env[PROFILING_ENV];
        } else {
            process.env[PROFILING_ENV] = originalProfilingValue;
        }
    });

    it('times out arming after a monotonic 50ms without blocking work metrics', async () => {
        const harness = createFakeRuntime({
            armHistogram: false,
        });
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });

        await armWorkerPerformanceCapture(capture);
        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => 'result'
        );

        expect(
            harness.scheduledTimeouts.reduce(
                (total, timeout) => total + timeout,
                0
            )
        ).toBe(50);
        expect(execution.performance).toMatchObject({
            eventLoopDelay: null,
            eventLoopDelayUnavailableReason:
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_ARM_TIMEOUT,
            eventLoopUtilization: 0.75,
            histogramFlushedEpochMs: null,
            threadCpuSystemMicros: 30,
            threadCpuUserMicros: 80,
        });
    });

    it('allows the second required histogram turn after a delayed first turn', async () => {
        const harness = createFakeRuntime({
            armHistogramAfterTimeoutCount: 2,
            timeoutElapsedMs: [86.202, 1, 1],
        });
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });

        await armWorkerPerformanceCapture(capture);
        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => 'result'
        );

        expect(harness.scheduledTimeouts.slice(0, 2)).toEqual([1, 1]);
        expect(execution.performance).toMatchObject({
            eventLoopDelay: {
                maxMs: 24,
                p95Ms: 18,
                p99Ms: 22,
            },
            eventLoopDelayUnavailableReason: null,
            histogramFlushedEpochMs: 145,
            invalidReason: null,
        });
    });

    it('times out after the second required turn when delayed arming never samples', async () => {
        const harness = createFakeRuntime({
            armHistogram: false,
            timeoutElapsedMs: [86.202, 1],
        });
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });

        await armWorkerPerformanceCapture(capture);
        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => 'result'
        );

        expect(harness.scheduledTimeouts).toEqual([1, 1]);
        expect(execution).toMatchObject({
            result: 'result',
            success: true,
            performance: {
                eventLoopDelay: null,
                eventLoopDelayUnavailableReason:
                    WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_ARM_TIMEOUT,
            },
        });
    });

    it('cannot poll forever when the monotonic runtime clock stalls', async () => {
        const harness = createFakeRuntime({
            armHistogram: false,
            stallMonotonicClock: true,
        });
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });

        await armWorkerPerformanceCapture(capture);
        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => 'result'
        );

        expect(harness.scheduledTimeouts).toHaveLength(50);
        expect(execution).toMatchObject({
            result: 'result',
            success: true,
            performance: {
                eventLoopDelay: null,
                eventLoopDelayUnavailableReason:
                    WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_ARM_TIMEOUT,
            },
        });
    });

    it('times out flushing after a monotonic 50ms while preserving work CPU and ELU', async () => {
        const harness = createFakeRuntime({
            flushHistogram: false,
        });
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });
        await armWorkerPerformanceCapture(capture);

        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => 'result'
        );

        expect(
            harness.scheduledTimeouts
                .slice(1)
                .reduce((total, timeout) => total + timeout, 0)
        ).toBe(50);
        expect(execution.performance).toMatchObject({
            eventLoopDelay: null,
            eventLoopDelayUnavailableReason:
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_FLUSH_TIMEOUT,
            eventLoopUtilization: 0.75,
            histogramFlushedEpochMs: null,
            threadCpuSystemMicros: 30,
            threadCpuUserMicros: 80,
        });
    });

    it('reports unavailable thread CPU without falling back to process CPU usage', async () => {
        const harness = createFakeRuntime({
            threadCpuAvailable: false,
        });
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });
        await armWorkerPerformanceCapture(capture);

        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => 'result'
        );

        expect(execution.performance).toMatchObject({
            eventLoopUtilization: 0.75,
            threadCpuSystemMicros: null,
            threadCpuUnavailableReason:
                WORKER_PERFORMANCE_UNAVAILABLE_REASON.THREAD_CPU_USAGE_UNAVAILABLE,
            threadCpuUserMicros: null,
        });
        expect(harness.lifecycle).not.toContain('cpu:1');
        expect(harness.lifecycle).not.toContain('cpu:2');
    });

    it('preserves the business result when CPU and ELU runtime callbacks throw', async () => {
        const harness = createFakeRuntime({
            throwBoundaryCallbacks: true,
        });
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });
        await armWorkerPerformanceCapture(capture);

        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => 'business-result'
        );

        expect(execution).toMatchObject({
            error: null,
            result: 'business-result',
            success: true,
            performance: {
                eventLoopDelay: {
                    maxMs: 24,
                    p95Ms: 18,
                    p99Ms: 22,
                },
                eventLoopUtilization: null,
                eventLoopUtilizationUnavailableReason:
                    WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_UTILIZATION_UNAVAILABLE,
                threadCpuSystemMicros: null,
                threadCpuUnavailableReason:
                    WORKER_PERFORMANCE_UNAVAILABLE_REASON.THREAD_CPU_USAGE_UNAVAILABLE,
                threadCpuUserMicros: null,
            },
        });
    });

    it('preserves work metrics and the business result when timer scheduling throws', async () => {
        const harness = createFakeRuntime({
            throwScheduleTimeout: true,
        });
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });
        await armWorkerPerformanceCapture(capture);

        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => 'business-result'
        );

        expect(execution).toMatchObject({
            error: null,
            result: 'business-result',
            success: true,
            performance: {
                eventLoopDelay: null,
                eventLoopDelayUnavailableReason:
                    WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_ARM_TIMEOUT,
                eventLoopUtilization: 0.75,
                threadCpuSystemMicros: 30,
                threadCpuUserMicros: 80,
            },
        });
    });

    it.each([
        {
            label: 'count getter during finish',
            options: {
                throwHistogramCountAtRead: 3,
            },
            reason: WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_CAPTURE_UNAVAILABLE,
        },
        {
            label: 'metric getter after flush',
            options: {
                throwHistogramMetric: true,
            },
            reason: WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_INVALID,
        },
    ])(
        'preserves the business result when the histogram $label throws',
        async ({ options, reason }) => {
            const harness = createFakeRuntime(options);
            const capture = startWorkerPerformanceCapture({
                enabled: true,
                runtime: harness.runtime,
            });
            await armWorkerPerformanceCapture(capture);

            const execution = await executeWithWorkerPerformanceCapture(
                capture,
                async () => 'business-result'
            );

            expect(execution).toMatchObject({
                error: null,
                result: 'business-result',
                success: true,
                performance: {
                    eventLoopDelay: null,
                    eventLoopDelayUnavailableReason: reason,
                    eventLoopUtilization: 0.75,
                    threadCpuSystemMicros: 30,
                    threadCpuUserMicros: 80,
                },
            });
        }
    );

    it('keeps the business result and rejects delay metrics when histogram disable throws', async () => {
        const harness = createFakeRuntime({
            throwHistogramDisable: true,
        });
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });
        await armWorkerPerformanceCapture(capture);

        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => 'business-result'
        );

        expect(execution).toMatchObject({
            error: null,
            result: 'business-result',
            success: true,
            performance: {
                eventLoopDelay: null,
                eventLoopDelayUnavailableReason:
                    WORKER_PERFORMANCE_UNAVAILABLE_REASON.EVENT_LOOP_DELAY_CAPTURE_UNAVAILABLE,
                eventLoopUtilization: 0.75,
                histogramFlushedEpochMs: null,
                threadCpuSystemMicros: 30,
                threadCpuUserMicros: 80,
            },
        });
    });
});
