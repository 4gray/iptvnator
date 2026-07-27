import type {
    DatabaseWorkerPerformancePhase,
    PerformancePhaseEvent,
    PerformancePhaseMetadata,
} from '@iptvnator/shared/interfaces';

import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';

const ACCOUNTING_KEYS = [
    'evidence',
    'eventLoopDelayMaxMs',
    'eventLoopDelayP95Ms',
    'eventLoopDelayP99Ms',
    'eventLoopUtilization',
    'invalidReasons',
    'invalidSampleCount',
    'metricScope',
    'totalCount',
    'validSampleCount',
] as const;
const EVENT_LOOP_DELAY_KEYS = ['maxMs', 'p95Ms', 'p99Ms'] as const;
const PHASE_EVENT_KEYS = [
    'boundary',
    'durationMs',
    'epochMs',
    'phase',
    'requestId',
] as const;
const PHASE_METADATA_KEYS = new Set(['byteCount', 'itemCount']);
const INVALID_REASON_KEYS = ['count', 'reason'] as const;

export const XTREAM_WORKER_REQUEST_KEYS = [
    'eventLoopDelay',
    'eventLoopDelayUnavailableReason',
    'eventLoopUtilization',
    'eventLoopUtilizationUnavailableReason',
    'histogramFlushedEpochMs',
    'ipcCallId',
    'invalidReason',
    'operation',
    'operationId',
    'operationIdUnavailableReason',
    'performanceCaptureUnavailableReason',
    'phaseEvents',
    'playlistId',
    'requestId',
    'requestReceivedEpochMs',
    'responseEpochMs',
    'responsePostedEpochMs',
    'sourceEpochMs',
    'success',
    'threadCpuSystemMicros',
    'threadCpuUnavailableReason',
    'threadCpuUserMicros',
    'workEndedEpochMs',
    'workStartedEpochMs',
] as const;

export function snapshotXtreamWorkerRequestAccounting(
    value: unknown
): Readonly<Record<string, unknown>> | null {
    try {
        const accounting = snapshotExactRecord(value, ACCOUNTING_KEYS);
        const evidence = snapshotArray(
            accounting['evidence'],
            snapshotWorkerRequest
        );
        const invalidReasons = snapshotArray(
            accounting['invalidReasons'],
            (reason) => snapshotExactRecord(reason, INVALID_REASON_KEYS)
        );
        return Object.freeze({
            ...accounting,
            evidence,
            invalidReasons,
        });
    } catch {
        return null;
    }
}

function snapshotWorkerRequest(
    value: unknown
): WorkerRequestPerformanceMetrics {
    const request = snapshotExactRecord(value, XTREAM_WORKER_REQUEST_KEYS);
    const eventLoopDelay =
        request['eventLoopDelay'] === null
            ? null
            : snapshotExactRecord(
                  request['eventLoopDelay'],
                  EVENT_LOOP_DELAY_KEYS
              );
    const phaseEvents = snapshotArray(
        request['phaseEvents'],
        snapshotPhaseEvent
    );
    return Object.freeze({
        ...request,
        eventLoopDelay,
        phaseEvents,
    }) as unknown as WorkerRequestPerformanceMetrics;
}

function snapshotPhaseEvent(
    value: unknown
): PerformancePhaseEvent<DatabaseWorkerPerformancePhase> {
    const hasMetadata = hasOwnDataProperty(value, 'metadata');
    const event = snapshotExactRecord(
        value,
        hasMetadata ? [...PHASE_EVENT_KEYS, 'metadata'] : PHASE_EVENT_KEYS
    );
    if (!hasMetadata) {
        return event as unknown as PerformancePhaseEvent<DatabaseWorkerPerformancePhase>;
    }
    const metadata =
        event['metadata'] === undefined
            ? undefined
            : snapshotPhaseMetadata(event['metadata']);
    return Object.freeze({
        ...event,
        metadata,
    }) as unknown as PerformancePhaseEvent<DatabaseWorkerPerformancePhase>;
}

function snapshotPhaseMetadata(value: unknown): PerformancePhaseMetadata {
    const keys = ownDataKeys(value);
    if (
        keys.length > PHASE_METADATA_KEYS.size ||
        keys.some((key) => !PHASE_METADATA_KEYS.has(key))
    ) {
        invalid();
    }
    return snapshotExactRecord(
        value,
        keys
    ) as unknown as PerformancePhaseMetadata;
}

function snapshotArray<T>(
    value: unknown,
    snapshotElement: (element: unknown) => T
): readonly T[] {
    if (!Array.isArray(value)) invalid();
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    const length = dataDescriptorValue(lengthDescriptor);
    if (
        !Number.isSafeInteger(length) ||
        Number(length) < 0 ||
        Number(length) > 512
    ) {
        invalid();
    }
    const expectedKeys = new Set<PropertyKey>(['length']);
    const snapshot: T[] = [];
    for (let index = 0; index < Number(length); index += 1) {
        const key = String(index);
        expectedKeys.add(key);
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        snapshot[index] = snapshotElement(dataDescriptorValue(descriptor));
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
        ownKeys.length !== expectedKeys.size ||
        ownKeys.some((key) => !expectedKeys.has(key))
    ) {
        invalid();
    }
    return Object.freeze(snapshot);
}

function snapshotExactRecord(
    value: unknown,
    keys: readonly string[]
): Readonly<Record<string, unknown>> {
    const ownKeys = ownDataKeys(value);
    if (
        ownKeys.length !== keys.length ||
        ownKeys.some((key) => !keys.includes(key))
    ) {
        invalid();
    }
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
        snapshot[key] = dataDescriptorValue(
            Reflect.getOwnPropertyDescriptor(value as object, key)
        );
    }
    return Object.freeze(snapshot);
}

function ownDataKeys(value: unknown): string[] {
    if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Reflect.getPrototypeOf(value))
    ) {
        invalid();
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) invalid();
    for (const key of keys) {
        dataDescriptorValue(Reflect.getOwnPropertyDescriptor(value, key));
    }
    return keys as string[];
}

function hasOwnDataProperty(value: unknown, key: string): boolean {
    if (typeof value !== 'object' || value === null) invalid();
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return false;
    dataDescriptorValue(descriptor);
    return true;
}

function dataDescriptorValue(
    descriptor: PropertyDescriptor | undefined
): unknown {
    if (
        !descriptor ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
        invalid();
    }
    return descriptor.value;
}

function invalid(): never {
    throw new Error('invalid Xtream worker request snapshot');
}
