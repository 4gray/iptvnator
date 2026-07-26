import {
    monitorEventLoopDelay,
    performance,
    type IntervalHistogram,
} from 'node:perf_hooks';

const WORKER_PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';

export interface WorkerPerformanceCaptureResult {
    eventLoopDelay: {
        maxMs: number;
        p95Ms: number;
        p99Ms: number;
    };
    eventLoopUtilization: number;
}

interface WorkerPerformanceCapture {
    eventLoopDelay: IntervalHistogram;
    eventLoopUtilizationStart: ReturnType<
        typeof performance.eventLoopUtilization
    >;
}

export function startWorkerPerformanceCapture(): WorkerPerformanceCapture | null {
    if (process.env[WORKER_PROFILING_ENV] !== '1') {
        return null;
    }

    const eventLoopDelay = monitorEventLoopDelay({ resolution: 1 });
    eventLoopDelay.enable();
    return {
        eventLoopDelay,
        eventLoopUtilizationStart: performance.eventLoopUtilization(),
    };
}

export async function armWorkerPerformanceCapture(
    capture: WorkerPerformanceCapture | null
): Promise<void> {
    if (capture) {
        await new Promise<void>((resolvePromise) =>
            setTimeout(resolvePromise, 2)
        );
    }
}

export async function finishWorkerPerformanceCapture(
    capture: WorkerPerformanceCapture | null
): Promise<WorkerPerformanceCaptureResult | undefined> {
    if (!capture) {
        return undefined;
    }

    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2));
    capture.eventLoopDelay.disable();
    const eventLoopUtilization = performance.eventLoopUtilization(
        capture.eventLoopUtilizationStart
    );
    return {
        eventLoopDelay: {
            maxMs: capture.eventLoopDelay.max / 1e6,
            p95Ms: capture.eventLoopDelay.percentile(95) / 1e6,
            p99Ms: capture.eventLoopDelay.percentile(99) / 1e6,
        },
        eventLoopUtilization: eventLoopUtilization.utilization,
    };
}
