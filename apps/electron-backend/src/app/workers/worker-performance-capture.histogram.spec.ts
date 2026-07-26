import {
    armWorkerPerformanceCapture,
    executeWithWorkerPerformanceCapture,
    startWorkerPerformanceCapture,
} from './worker-performance-capture';
import { createFakeRuntime } from './worker-performance-capture.test-harness';

describe('worker performance histogram lifecycle', () => {
    it('accepts a nonthrowing false disable result because the histogram is already disabled', async () => {
        const harness = createFakeRuntime({
            histogramDisableResult: false,
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
                eventLoopDelayUnavailableReason: null,
                histogramFlushedEpochMs: 145,
            },
        });
    });
});
