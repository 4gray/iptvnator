import type {
    EventLoopDelayMetrics,
    MainCaptureMetrics,
    WorkerCaptureMetrics,
    WorkerPostGcHeapCapture,
    WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';
import { WORKER_POST_GC_HEAP_UNAVAILABLE_REASON } from './m3u-refresh-cancellation-contract';

export interface WorkerRequestPerformanceOutcomeTransport {
    readonly operation: string | null;
    readonly operationId: string | null;
    readonly operationIdUnavailableReason: string | null;
    readonly performanceCapture: unknown;
    readonly playlistId: string | null;
    readonly requestId: string | null;
    readonly responseEpochMs: number;
    readonly success: boolean;
}

export interface MainCaptureGenerationTransport {
    readonly captureGeneration: number;
    readonly metrics: Omit<MainCaptureMetrics, 'workers'>;
    readonly workers: readonly {
        readonly captureGeneration: number | null;
        readonly metrics: Omit<
            WorkerCaptureMetrics,
            'eventLoopDelay' | 'eventLoopDelayUnavailableReason' | 'requests'
        >;
        readonly requests: readonly WorkerRequestPerformanceOutcomeTransport[];
    }[];
}

type ParsedWorkerPerformanceCapture = Pick<
    WorkerRequestPerformanceMetrics,
    | 'eventLoopDelay'
    | 'eventLoopDelayUnavailableReason'
    | 'eventLoopUtilization'
    | 'eventLoopUtilizationUnavailableReason'
    | 'histogramFlushedEpochMs'
    | 'invalidReason'
    | 'requestReceivedEpochMs'
    | 'threadCpuSystemMicros'
    | 'threadCpuUnavailableReason'
    | 'threadCpuUserMicros'
    | 'workEndedEpochMs'
    | 'workStartedEpochMs'
>;

const INVALID_REASONS = new Set(['overlapping-database-worker-requests']);
const EVENT_LOOP_DELAY_REASONS = new Set([
    ...INVALID_REASONS,
    'event-loop-delay-arm-timeout',
    'event-loop-delay-capture-unavailable',
    'event-loop-delay-flush-timeout',
    'event-loop-delay-invalid',
]);
const EVENT_LOOP_UTILIZATION_REASONS = new Set([
    ...INVALID_REASONS,
    'event-loop-utilization-unavailable',
]);
const THREAD_CPU_REASONS = new Set([
    ...INVALID_REASONS,
    'thread-cpu-usage-invalid',
    'thread-cpu-usage-unavailable',
]);
const WORKER_POST_GC_HEAP_UNAVAILABLE_REASONS = new Set<string>(
    Object.values(WORKER_POST_GC_HEAP_UNAVAILABLE_REASON)
);

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNullableFiniteNonNegativeNumber(
    value: unknown
): value is number | null {
    return value === null || isFiniteNonNegativeNumber(value);
}

function isNullableReason(
    value: unknown,
    allowed: ReadonlySet<string>
): value is string | null {
    return value === null || (typeof value === 'string' && allowed.has(value));
}

function normalizeWorkerPostGcHeapCapture(
    input: Record<string, unknown>
): WorkerPostGcHeapCapture {
    const postGcHeapUnavailableReason = input['postGcHeapUnavailableReason'];
    const postGcHeapUsedBytes = input['postGcHeapUsedBytes'];
    if (
        Number.isSafeInteger(postGcHeapUsedBytes) &&
        Number(postGcHeapUsedBytes) >= 0 &&
        postGcHeapUnavailableReason === null
    ) {
        return {
            postGcHeapUnavailableReason: null,
            postGcHeapUsedBytes: Number(postGcHeapUsedBytes),
        };
    }
    if (
        postGcHeapUsedBytes === null &&
        typeof postGcHeapUnavailableReason === 'string' &&
        WORKER_POST_GC_HEAP_UNAVAILABLE_REASONS.has(postGcHeapUnavailableReason)
    ) {
        return {
            postGcHeapUnavailableReason,
            postGcHeapUsedBytes: null,
        } as WorkerPostGcHeapCapture;
    }
    return {
        postGcHeapUnavailableReason:
            WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.INVALID_CAPTURE,
        postGcHeapUsedBytes: null,
    };
}

function parseEventLoopDelay(
    input: unknown
): EventLoopDelayMetrics | null | undefined {
    if (input === null) {
        return null;
    }
    if (!isRecord(input)) {
        return undefined;
    }
    const maxMs = input['maxMs'];
    const p95Ms = input['p95Ms'];
    const p99Ms = input['p99Ms'];
    if (
        !isFiniteNonNegativeNumber(maxMs) ||
        !isFiniteNonNegativeNumber(p95Ms) ||
        !isFiniteNonNegativeNumber(p99Ms) ||
        p95Ms > p99Ms ||
        p99Ms > maxMs
    ) {
        return undefined;
    }
    return { maxMs, p95Ms, p99Ms };
}

function parseWorkerPerformanceCapture(
    input: unknown
): ParsedWorkerPerformanceCapture | null {
    if (!isRecord(input)) {
        return null;
    }

    const eventLoopDelay = parseEventLoopDelay(input['eventLoopDelay']);
    const eventLoopDelayUnavailableReason =
        input['eventLoopDelayUnavailableReason'];
    const eventLoopUtilization = input['eventLoopUtilization'];
    const eventLoopUtilizationUnavailableReason =
        input['eventLoopUtilizationUnavailableReason'];
    const histogramFlushedEpochMs = input['histogramFlushedEpochMs'];
    const invalidReason = input['invalidReason'];
    const requestReceivedEpochMs = input['requestReceivedEpochMs'];
    const threadCpuSystemMicros = input['threadCpuSystemMicros'];
    const threadCpuUnavailableReason = input['threadCpuUnavailableReason'];
    const threadCpuUserMicros = input['threadCpuUserMicros'];
    const workEndedEpochMs = input['workEndedEpochMs'];
    const workStartedEpochMs = input['workStartedEpochMs'];

    if (
        eventLoopDelay === undefined ||
        !isNullableReason(
            eventLoopDelayUnavailableReason,
            EVENT_LOOP_DELAY_REASONS
        ) ||
        !isNullableFiniteNonNegativeNumber(eventLoopUtilization) ||
        (eventLoopUtilization !== null && eventLoopUtilization > 1) ||
        !isNullableReason(
            eventLoopUtilizationUnavailableReason,
            EVENT_LOOP_UTILIZATION_REASONS
        ) ||
        !isNullableFiniteNonNegativeNumber(histogramFlushedEpochMs) ||
        !isNullableReason(invalidReason, INVALID_REASONS) ||
        !isFiniteNonNegativeNumber(requestReceivedEpochMs) ||
        !isNullableFiniteNonNegativeNumber(threadCpuSystemMicros) ||
        !isNullableReason(threadCpuUnavailableReason, THREAD_CPU_REASONS) ||
        !isNullableFiniteNonNegativeNumber(threadCpuUserMicros) ||
        !isFiniteNonNegativeNumber(workEndedEpochMs) ||
        !isFiniteNonNegativeNumber(workStartedEpochMs)
    ) {
        return null;
    }

    const timestampsAreOrdered =
        requestReceivedEpochMs <= workStartedEpochMs &&
        workStartedEpochMs <= workEndedEpochMs &&
        (histogramFlushedEpochMs === null ||
            workEndedEpochMs <= histogramFlushedEpochMs);
    const eventLoopDelayIsCoherent =
        eventLoopDelay === null
            ? eventLoopDelayUnavailableReason !== null &&
              (eventLoopDelayUnavailableReason === 'event-loop-delay-invalid'
                  ? histogramFlushedEpochMs !== null
                  : histogramFlushedEpochMs === null)
            : eventLoopDelayUnavailableReason === null &&
              histogramFlushedEpochMs !== null;
    const eventLoopUtilizationIsCoherent =
        eventLoopUtilization === null
            ? eventLoopUtilizationUnavailableReason !== null
            : eventLoopUtilizationUnavailableReason === null;
    const threadCpuIsCoherent =
        threadCpuSystemMicros === null && threadCpuUserMicros === null
            ? threadCpuUnavailableReason !== null
            : threadCpuSystemMicros !== null &&
              threadCpuUserMicros !== null &&
              threadCpuUnavailableReason === null;
    const invalidCaptureIsCoherent =
        invalidReason === null ||
        (eventLoopDelay === null &&
            eventLoopDelayUnavailableReason === invalidReason &&
            eventLoopUtilization === null &&
            eventLoopUtilizationUnavailableReason === invalidReason &&
            histogramFlushedEpochMs === null &&
            threadCpuSystemMicros === null &&
            threadCpuUnavailableReason === invalidReason &&
            threadCpuUserMicros === null);
    if (
        !timestampsAreOrdered ||
        !eventLoopDelayIsCoherent ||
        !eventLoopUtilizationIsCoherent ||
        !threadCpuIsCoherent ||
        !invalidCaptureIsCoherent
    ) {
        return null;
    }

    return {
        eventLoopDelay,
        eventLoopDelayUnavailableReason,
        eventLoopUtilization,
        eventLoopUtilizationUnavailableReason,
        histogramFlushedEpochMs,
        invalidReason,
        requestReceivedEpochMs,
        threadCpuSystemMicros,
        threadCpuUnavailableReason,
        threadCpuUserMicros,
        workEndedEpochMs,
        workStartedEpochMs,
    };
}

export function normalizeWorkerRequestPerformanceOutcome(
    input: WorkerRequestPerformanceOutcomeTransport
): WorkerRequestPerformanceMetrics {
    const identity = {
        operation: input.operation,
        operationId: input.operationId,
        operationIdUnavailableReason: input.operationIdUnavailableReason,
        playlistId: input.playlistId,
        requestId: input.requestId,
        responseEpochMs: input.responseEpochMs,
        success: input.success,
    };
    const unavailable = (
        reason:
            | 'worker-performance-capture-invalid'
            | 'worker-performance-capture-missing'
    ): WorkerRequestPerformanceMetrics => ({
        eventLoopDelay: null,
        eventLoopDelayUnavailableReason: null,
        eventLoopUtilization: null,
        eventLoopUtilizationUnavailableReason: null,
        histogramFlushedEpochMs: null,
        invalidReason: null,
        ...identity,
        performanceCaptureUnavailableReason: reason,
        requestReceivedEpochMs: null,
        threadCpuSystemMicros: null,
        threadCpuUnavailableReason: null,
        threadCpuUserMicros: null,
        workEndedEpochMs: null,
        workStartedEpochMs: null,
    });

    if (
        input.performanceCapture === undefined ||
        input.performanceCapture === null
    ) {
        return unavailable('worker-performance-capture-missing');
    }

    const performanceCapture = parseWorkerPerformanceCapture(
        input.performanceCapture
    );
    if (!performanceCapture) {
        return unavailable('worker-performance-capture-invalid');
    }

    return {
        ...performanceCapture,
        ...identity,
        performanceCaptureUnavailableReason: null,
    };
}

export function selectMainCaptureGeneration(
    input: MainCaptureGenerationTransport
): MainCaptureMetrics {
    const workers = input.workers
        .filter(
            (worker) => worker.captureGeneration === input.captureGeneration
        )
        .map((worker): WorkerCaptureMetrics => {
            const requests = worker.requests.map(
                normalizeWorkerRequestPerformanceOutcome
            );
            const onlyRequest =
                requests.length === 1 ? (requests[0] ?? null) : null;
            const postGcHeap = normalizeWorkerPostGcHeapCapture(
                worker.metrics as unknown as Record<string, unknown>
            );
            return {
                ...worker.metrics,
                ...postGcHeap,
                eventLoopDelay: onlyRequest?.eventLoopDelay ?? null,
                eventLoopDelayUnavailableReason: onlyRequest
                    ? (onlyRequest.eventLoopDelayUnavailableReason ??
                      onlyRequest.performanceCaptureUnavailableReason ??
                      'worker-self-profile-result-unavailable')
                    : requests.length > 1
                      ? 'multiple-request-scoped-captures'
                      : worker.metrics.terminatedEpochMs !== null
                        ? 'worker-terminated-before-profile-flush'
                        : 'worker-self-profile-result-unavailable',
                requests,
            };
        });
    return {
        ...input.metrics,
        workers,
    };
}
