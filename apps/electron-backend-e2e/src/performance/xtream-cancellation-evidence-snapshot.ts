import type { DatabaseWorkerCancelTimelineRecord } from './database-worker-cancel-capture';
import type { XtreamCancellationEvidence } from './xtream-summary-contract';

const EVIDENCE_KEYS = ['timeline'] as const;
const RECORD_KEYS = [
    'epochMs',
    'ipcCallId',
    'operationId',
    'requestId',
    'sourceEpochMs',
    'type',
] as const;
const MAX_TIMELINE_LENGTH = 16;

export function snapshotXtreamCancellationEvidence(
    value: unknown
): XtreamCancellationEvidence | null {
    try {
        const evidence = snapshotExactRecord(value, EVIDENCE_KEYS);
        const timeline = snapshotExactArray(
            evidence['timeline'],
            snapshotTimelineRecord
        );
        return Object.freeze({ timeline });
    } catch {
        return null;
    }
}

function snapshotTimelineRecord(
    value: unknown
): DatabaseWorkerCancelTimelineRecord {
    return snapshotExactRecord(
        value,
        RECORD_KEYS
    ) as unknown as DatabaseWorkerCancelTimelineRecord;
}

function snapshotExactArray<T>(
    value: unknown,
    snapshotEntry: (entry: unknown) => T
): readonly T[] {
    if (!Array.isArray(value)) invalid();
    const length = dataDescriptorValue(
        Reflect.getOwnPropertyDescriptor(value, 'length')
    );
    if (
        !Number.isSafeInteger(length) ||
        Number(length) < 0 ||
        Number(length) > MAX_TIMELINE_LENGTH
    ) {
        invalid();
    }
    const expectedKeys = new Set<PropertyKey>(['length']);
    const snapshot: T[] = [];
    for (let index = 0; index < Number(length); index += 1) {
        const key = String(index);
        expectedKeys.add(key);
        snapshot[index] = snapshotEntry(
            dataDescriptorValue(Reflect.getOwnPropertyDescriptor(value, key))
        );
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
    if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Reflect.getPrototypeOf(value))
    ) {
        invalid();
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
        ownKeys.length !== keys.length ||
        ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
        invalid();
    }
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
        snapshot[key] = dataDescriptorValue(
            Reflect.getOwnPropertyDescriptor(value, key)
        );
    }
    return Object.freeze(snapshot);
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
    throw new Error('invalid Xtream cancellation evidence snapshot');
}
