import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import { XTREAM_WORKER_REQUEST_INVALID_REASON } from './xtream-summary-contract';

export interface XtreamWorkerRequestWindowProxy {
    readonly eventLoopDelayMaxMs: number;
    readonly eventLoopDelayP95Ms: number;
    readonly eventLoopDelayP99Ms: number;
    readonly eventLoopUtilization: number;
}

export function deriveXtreamWorkerRequestWindowProxy(
    evidence: readonly WorkerRequestPerformanceMetrics[]
): XtreamWorkerRequestWindowProxy | null {
    const valid = evidence.filter(
        ({ invalidReason }) =>
            invalidReason !==
            XTREAM_WORKER_REQUEST_INVALID_REASON.OVERLAPPING_DATABASE_REQUESTS
    );
    if (
        valid.length === 0 ||
        valid.some(
            ({ eventLoopDelay, eventLoopUtilization, invalidReason }) =>
                invalidReason !== null ||
                !isDelay(eventLoopDelay) ||
                !isUtilization(eventLoopUtilization)
        )
    ) {
        return null;
    }
    return {
        eventLoopDelayMaxMs: Math.max(
            ...valid.map(({ eventLoopDelay }) => eventLoopDelay?.maxMs ?? 0)
        ),
        eventLoopDelayP95Ms: Math.max(
            ...valid.map(({ eventLoopDelay }) => eventLoopDelay?.p95Ms ?? 0)
        ),
        eventLoopDelayP99Ms: Math.max(
            ...valid.map(({ eventLoopDelay }) => eventLoopDelay?.p99Ms ?? 0)
        ),
        eventLoopUtilization: Math.max(
            ...valid.map(
                ({ eventLoopUtilization }) => eventLoopUtilization ?? 0
            )
        ),
    };
}

function isDelay(
    value: WorkerRequestPerformanceMetrics['eventLoopDelay']
): value is NonNullable<WorkerRequestPerformanceMetrics['eventLoopDelay']> {
    return (
        value !== null &&
        [value.p95Ms, value.p99Ms, value.maxMs].every(
            (sample) =>
                typeof sample === 'number' &&
                Number.isFinite(sample) &&
                sample >= 0
        ) &&
        value.p95Ms <= value.p99Ms &&
        value.p99Ms <= value.maxMs
    );
}

function isUtilization(value: number | null): value is number {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
    );
}
