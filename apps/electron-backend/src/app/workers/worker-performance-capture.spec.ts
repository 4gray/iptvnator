import {
    WORKER_PERFORMANCE_UNAVAILABLE_REASON,
    armWorkerPerformanceCapture,
    executeWithWorkerPerformanceCapture,
    stampWorkerPerformanceResponsePostedEpoch,
    startWorkerPerformanceCapture,
} from './worker-performance-capture';
import { createFakeRuntime } from './worker-performance-capture.test-harness';

const PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';

describe('worker performance capture', () => {
    const originalProfilingValue = process.env[PROFILING_ENV];

    afterEach(() => {
        if (originalProfilingValue === undefined) {
            delete process.env[PROFILING_ENV];
        } else {
            process.env[PROFILING_ENV] = originalProfilingValue;
        }
    });

    it('is disabled unless explicitly opted in', () => {
        delete process.env[PROFILING_ENV];

        expect(startWorkerPerformanceCapture()).toBeNull();
    });

    it('captures exact work-boundary CPU, ELU, timestamps, and a flushed fresh histogram', async () => {
        const harness = createFakeRuntime();
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });
        await armWorkerPerformanceCapture(capture);

        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => {
                harness.lifecycle.push('execute');
                await Promise.resolve();
                harness.lifecycle.push('execute:settled');
                return 'result';
            }
        );

        expect(execution).toEqual({
            error: null,
            performance: {
                eventLoopDelay: {
                    maxMs: 24,
                    p95Ms: 18,
                    p99Ms: 22,
                },
                eventLoopDelayUnavailableReason: null,
                eventLoopUtilization: 0.75,
                eventLoopUtilizationUnavailableReason: null,
                histogramFlushedEpochMs: 145,
                invalidReason: null,
                requestReceivedEpochMs: 100,
                threadCpuSystemMicros: 30,
                threadCpuUnavailableReason: null,
                threadCpuUserMicros: 80,
                workEndedEpochMs: 140,
                workStartedEpochMs: 110,
            },
            result: 'result',
            success: true,
        });
        expect(harness.lifecycle).toEqual([
            'epoch:100',
            'histogram:create',
            'timeout:1',
            'epoch:110',
            'cpu:1',
            'elu:1',
            'execute',
            'execute:settled',
            'epoch:140',
            'cpu:2',
            'elu:2',
            'timeout:1',
            'epoch:145',
        ]);
        expect(harness.histogramLifecycle.enableCalls).toBe(1);
        expect(harness.histogramLifecycle.disableCalls).toBe(1);
        expect('reset' in harness.histogram).toBe(false);
    });

    it('stamps the worker-send boundary only after request profiling has finished', async () => {
        const harness = createFakeRuntime();
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });
        await armWorkerPerformanceCapture(capture);
        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => 'result'
        );

        const stamped = stampWorkerPerformanceResponsePostedEpoch(
            capture,
            execution.performance
        );

        expect(stamped).toMatchObject({
            histogramFlushedEpochMs: 145,
            responsePostedEpochMs: 149,
            workEndedEpochMs: 140,
        });
        expect(harness.lifecycle.at(-1)).toBe('epoch:149');
        expect(
            stampWorkerPerformanceResponsePostedEpoch(null, undefined)
        ).toBeUndefined();
    });

    it('finishes profiling before returning a rejected execution to worker side effects', async () => {
        const harness = createFakeRuntime();
        const capture = startWorkerPerformanceCapture({
            enabled: true,
            runtime: harness.runtime,
        });
        const failure = new Error('worker failed');
        await armWorkerPerformanceCapture(capture);

        const execution = await executeWithWorkerPerformanceCapture(
            capture,
            async () => {
                harness.lifecycle.push('execute');
                await Promise.resolve();
                harness.lifecycle.push('execute:rejected');
                throw failure;
            }
        );
        harness.lifecycle.push('worker:emit-error');

        expect(execution).toMatchObject({
            error: failure,
            success: false,
        });
        expect(harness.lifecycle.indexOf('epoch:140')).toBe(
            harness.lifecycle.indexOf('execute:rejected') + 1
        );
        expect(harness.lifecycle.indexOf('worker:emit-error')).toBeGreaterThan(
            harness.lifecycle.indexOf('epoch:145')
        );
    });
});
