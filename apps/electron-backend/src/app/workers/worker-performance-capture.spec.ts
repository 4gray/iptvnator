import {
    armWorkerPerformanceCapture,
    finishWorkerPerformanceCapture,
    startWorkerPerformanceCapture,
} from './worker-performance-capture';

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

    it('reports finite worker event-loop metrics when opted in', async () => {
        process.env[PROFILING_ENV] = '1';

        const capture = startWorkerPerformanceCapture();
        await armWorkerPerformanceCapture(capture);
        const blockStartedAt = performance.now();
        while (performance.now() - blockStartedAt < 20) {
            // Deliberately block the loop so the histogram contract is tested.
        }
        const result = await finishWorkerPerformanceCapture(capture);

        expect(result).toEqual({
            eventLoopDelay: {
                maxMs: expect.any(Number),
                p95Ms: expect.any(Number),
                p99Ms: expect.any(Number),
            },
            eventLoopUtilization: expect.any(Number),
        });
        expect(result?.eventLoopUtilization).toBeGreaterThanOrEqual(0);
        expect(result?.eventLoopDelay.maxMs).toBeGreaterThan(10);
    });
});
