import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type {
    WorkerPerformanceCaptureRuntime,
    WorkerEventLoopDelayHistogram,
} from './worker-performance-capture.model';

export const WORKER_PROFILING_ENV = 'IPTVNATOR_PERF_WORKER_PROFILING';
export const HISTOGRAM_POLL_INTERVAL_MS = 1;
export const HISTOGRAM_WAIT_CAP_MS = 50;

function readRuntimeThreadCpuUsage(): (() => NodeJS.CpuUsage) | null {
    const candidate: unknown = Reflect.get(process, 'threadCpuUsage');
    if (typeof candidate !== 'function') {
        return null;
    }

    return () =>
        (candidate as (this: NodeJS.Process) => NodeJS.CpuUsage).call(process);
}

export const DEFAULT_WORKER_PERFORMANCE_RUNTIME: WorkerPerformanceCaptureRuntime =
    {
        createEventLoopDelayHistogram: (): WorkerEventLoopDelayHistogram =>
            monitorEventLoopDelay({
                resolution: HISTOGRAM_POLL_INTERVAL_MS,
            }),
        readEpochMs: () => performance.timeOrigin + performance.now(),
        readEventLoopUtilization: () => performance.eventLoopUtilization(),
        readMonotonicMs: () => performance.now(),
        readThreadCpuUsage: readRuntimeThreadCpuUsage(),
        scheduleTimeout: (callback, delayMs) => {
            setTimeout(callback, delayMs);
        },
    };

export function safeReadEpochMs(
    runtime: WorkerPerformanceCaptureRuntime
): number {
    try {
        const epochMs = runtime.readEpochMs();
        return Number.isFinite(epochMs) ? epochMs : Date.now();
    } catch {
        return Date.now();
    }
}
