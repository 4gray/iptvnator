import type {
    WorkerEventLoopDelayHistogram,
    WorkerPerformanceCaptureRuntime,
} from './worker-performance-capture';

interface FakeRuntimeOptions {
    armHistogram?: boolean;
    flushHistogram?: boolean;
    histogramDisableResult?: boolean;
    stallMonotonicClock?: boolean;
    threadCpuAvailable?: boolean;
    throwBoundaryCallbacks?: boolean;
    throwHistogramDisable?: boolean;
    throwHistogramCountAtRead?: number;
    throwHistogramMetric?: boolean;
    throwScheduleTimeout?: boolean;
}

export interface FakeRuntimeHarness {
    histogram: WorkerEventLoopDelayHistogram;
    histogramLifecycle: {
        disableCalls: number;
        enableCalls: number;
    };
    lifecycle: string[];
    runtime: WorkerPerformanceCaptureRuntime;
    scheduledTimeouts: number[];
}

export function createFakeRuntime(
    options: FakeRuntimeOptions = {}
): FakeRuntimeHarness {
    const lifecycle: string[] = [];
    const scheduledTimeouts: number[] = [];
    let epochIndex = 0;
    let monotonicMs = 0;
    let timeoutCount = 0;
    let cpuIndex = 0;
    let eluIndex = 0;
    let histogramCount = 0;
    let histogramCountReads = 0;
    const histogramLifecycle = {
        disableCalls: 0,
        enableCalls: 0,
    };
    const epochValues = [100, 110, 140, 145];
    const cpuValues = [
        { system: 50, user: 100 },
        { system: 80, user: 180 },
    ];
    const eluValues = [
        { active: 10, idle: 20, utilization: 1 / 3 },
        { active: 40, idle: 30, utilization: 4 / 7 },
    ];
    const histogram = {
        get count() {
            histogramCountReads += 1;
            if (histogramCountReads === options.throwHistogramCountAtRead) {
                throw new Error('histogram count unavailable');
            }
            return histogramCount;
        },
        disable: () => {
            histogramLifecycle.disableCalls += 1;
            if (options.throwHistogramDisable === true) {
                throw new Error('histogram disable unavailable');
            }
            return options.histogramDisableResult ?? true;
        },
        enable: () => {
            histogramLifecycle.enableCalls += 1;
            return true;
        },
        get max() {
            if (options.throwHistogramMetric === true) {
                throw new Error('histogram max unavailable');
            }
            return 24_000_000;
        },
        percentile: (percentile: number) => {
            if (options.throwHistogramMetric === true) {
                throw new Error('histogram percentile unavailable');
            }
            if (percentile === 95) {
                return 18_000_000;
            }
            if (percentile === 99) {
                return 22_000_000;
            }
            return 0;
        },
    } satisfies WorkerEventLoopDelayHistogram;
    const runtime: WorkerPerformanceCaptureRuntime = {
        createEventLoopDelayHistogram: () => {
            lifecycle.push('histogram:create');
            return histogram;
        },
        readEpochMs: () => {
            const value = epochValues[epochIndex] ?? 145 + epochIndex;
            epochIndex += 1;
            lifecycle.push(`epoch:${value}`);
            return value;
        },
        readEventLoopUtilization: () => {
            if (options.throwBoundaryCallbacks === true) {
                throw new Error('ELU callback unavailable');
            }
            const value = eluValues[eluIndex] ?? eluValues.at(-1)!;
            eluIndex += 1;
            lifecycle.push(`elu:${eluIndex}`);
            return value;
        },
        readMonotonicMs: () => monotonicMs,
        readThreadCpuUsage:
            options.threadCpuAvailable === false
                ? null
                : () => {
                      if (options.throwBoundaryCallbacks === true) {
                          throw new Error('thread CPU callback unavailable');
                      }
                      const value = cpuValues[cpuIndex] ?? cpuValues.at(-1)!;
                      cpuIndex += 1;
                      lifecycle.push(`cpu:${cpuIndex}`);
                      return value;
                  },
        scheduleTimeout: (callback, delayMs) => {
            lifecycle.push(`timeout:${delayMs}`);
            scheduledTimeouts.push(delayMs);
            if (options.throwScheduleTimeout === true) {
                throw new Error('timer callback unavailable');
            }
            if (options.stallMonotonicClock !== true) {
                monotonicMs += delayMs;
            } else if (timeoutCount >= 55) {
                throw new Error('test scheduler fail-safe');
            }
            timeoutCount += 1;
            if (timeoutCount === 1 && options.armHistogram !== false) {
                histogramCount += 1;
            } else if (
                timeoutCount > 1 &&
                options.armHistogram !== false &&
                options.flushHistogram !== false
            ) {
                histogramCount += 1;
            }
            callback();
        },
    };

    return {
        histogram,
        histogramLifecycle,
        lifecycle,
        runtime,
        scheduledTimeouts,
    };
}
