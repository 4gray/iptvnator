import type { EventLoopUtilization } from 'node:perf_hooks';
import type {
    AppPlaylistPerformancePhase,
    PerformancePhaseEvent,
} from '@iptvnator/shared/interfaces';

export const WORKER_PERFORMANCE_INVALID_REASON = {
    OVERLAPPING_DATABASE_WORKER_REQUESTS:
        'overlapping-database-worker-requests',
} as const;

export type WorkerPerformanceInvalidReason =
    (typeof WORKER_PERFORMANCE_INVALID_REASON)[keyof typeof WORKER_PERFORMANCE_INVALID_REASON];

export const WORKER_PERFORMANCE_UNAVAILABLE_REASON = {
    EVENT_LOOP_DELAY_ARM_TIMEOUT: 'event-loop-delay-arm-timeout',
    EVENT_LOOP_DELAY_CAPTURE_UNAVAILABLE:
        'event-loop-delay-capture-unavailable',
    EVENT_LOOP_DELAY_FLUSH_TIMEOUT: 'event-loop-delay-flush-timeout',
    EVENT_LOOP_DELAY_INVALID: 'event-loop-delay-invalid',
    EVENT_LOOP_UTILIZATION_UNAVAILABLE: 'event-loop-utilization-unavailable',
    THREAD_CPU_USAGE_INVALID: 'thread-cpu-usage-invalid',
    THREAD_CPU_USAGE_UNAVAILABLE: 'thread-cpu-usage-unavailable',
} as const;

export type WorkerPerformanceUnavailableReason =
    (typeof WORKER_PERFORMANCE_UNAVAILABLE_REASON)[keyof typeof WORKER_PERFORMANCE_UNAVAILABLE_REASON];

export type WorkerPerformanceMetricUnavailableReason =
    WorkerPerformanceInvalidReason | WorkerPerformanceUnavailableReason;

export interface WorkerEventLoopDelayMetrics {
    maxMs: number;
    p95Ms: number;
    p99Ms: number;
}

export interface WorkerEventLoopDelayHistogram {
    readonly count: number;
    readonly max: number;
    disable: () => boolean;
    enable: () => boolean;
    percentile: (percentile: number) => number;
}

export interface WorkerPerformanceCaptureResult {
    eventLoopDelay: WorkerEventLoopDelayMetrics | null;
    eventLoopDelayUnavailableReason: WorkerPerformanceMetricUnavailableReason | null;
    eventLoopUtilization: number | null;
    eventLoopUtilizationUnavailableReason: WorkerPerformanceMetricUnavailableReason | null;
    histogramFlushedEpochMs: number | null;
    invalidReason: WorkerPerformanceInvalidReason | null;
    phaseEvents?: readonly PerformancePhaseEvent<AppPlaylistPerformancePhase>[];
    requestReceivedEpochMs: number;
    responsePostedEpochMs?: number;
    threadCpuSystemMicros: number | null;
    threadCpuUnavailableReason: WorkerPerformanceMetricUnavailableReason | null;
    threadCpuUserMicros: number | null;
    workEndedEpochMs: number;
    workStartedEpochMs: number;
}

export interface WorkerPerformanceCaptureRuntime {
    createEventLoopDelayHistogram: () => WorkerEventLoopDelayHistogram;
    readEpochMs: () => number;
    readEventLoopUtilization: () => EventLoopUtilization;
    readMonotonicMs: () => number;
    readThreadCpuUsage: (() => NodeJS.CpuUsage) | null;
    scheduleTimeout: (callback: () => void, delayMs: number) => void;
}

export interface WorkerPerformanceCaptureOptions {
    enabled?: boolean;
    requestId?: string;
    runtime?: WorkerPerformanceCaptureRuntime;
}

export interface WorkerPerformanceExecutionResult<TResult> {
    error: unknown | null;
    performance: WorkerPerformanceCaptureResult | undefined;
    result: TResult | undefined;
    success: boolean;
}

export interface WorkerPerformanceCapture {
    eventLoopDelay: WorkerEventLoopDelayHistogram | null;
    eventLoopDelayUnavailableReason: WorkerPerformanceMetricUnavailableReason | null;
    eventLoopUtilizationEnd: EventLoopUtilization | null;
    eventLoopUtilizationStart: EventLoopUtilization | null;
    eventLoopUtilizationUnavailableReason: WorkerPerformanceMetricUnavailableReason | null;
    histogramDisabled: boolean;
    histogramFlushedEpochMs: number | null;
    invalidReason: WorkerPerformanceInvalidReason | null;
    phaseEvents: PerformancePhaseEvent<AppPlaylistPerformancePhase>[];
    requestReceivedEpochMs: number;
    requestId: string | null;
    runtime: WorkerPerformanceCaptureRuntime;
    threadCpuEnd: NodeJS.CpuUsage | null;
    threadCpuStart: NodeJS.CpuUsage | null;
    threadCpuUnavailableReason: WorkerPerformanceMetricUnavailableReason | null;
    workEndedEpochMs: number | null;
    workStartedEpochMs: number | null;
}
