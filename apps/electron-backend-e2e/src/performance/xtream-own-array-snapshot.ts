import type {
    XtreamAttributionPhaseEvent,
    XtreamIpcAttributionSpan,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';

const MAX_CAPTURE_ARRAY_LENGTH = 512;
const EVENT_KEYS = [
    'boundary',
    'categoryType',
    'contentType',
    'correlationId',
    'durationMs',
    'epochMs',
    'itemCount',
    'phase',
    'providerAction',
    'semanticType',
] as const;
const IPC_SPAN_KEYS = [
    'boundary',
    'correlationId',
    'endEpochMs',
    'ipcCallId',
    'method',
    'outcome',
    'sourceEpochMs',
    'startEpochMs',
] as const;

export function snapshotXtreamPhaseInput(
    input: XtreamPhaseAttributionInput
): XtreamPhaseAttributionInput {
    return Object.freeze({
        backgroundSearchMarkerObserved: input.backgroundSearchMarkerObserved,
        events: snapshotArray(input.events, (event) =>
            snapshotRecord<XtreamAttributionPhaseEvent>(event, EVENT_KEYS)
        ),
        ipcSpans: snapshotArray(input.ipcSpans, (span) =>
            snapshotRecord<XtreamIpcAttributionSpan>(span, IPC_SPAN_KEYS)
        ),
        operationStartEpochMs: input.operationStartEpochMs,
        scenarioId: input.scenarioId,
        terminalEpochMs: input.terminalEpochMs,
        uiPaintEpochMs: input.uiPaintEpochMs,
    });
}

function snapshotArray<T>(
    value: unknown,
    snapshotElement: (element: unknown) => T
): readonly T[] {
    if (!Array.isArray(value)) invalid();
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (
        !Number.isSafeInteger(length) ||
        Number(length) < 0 ||
        Number(length) > MAX_CAPTURE_ARRAY_LENGTH
    ) {
        invalid();
    }
    const expectedKeys = new Set<PropertyKey>(['length']);
    const snapshot: T[] = [];
    for (let index = 0; index < Number(length); index += 1) {
        const key = String(index);
        expectedKeys.add(key);
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (
            !descriptor ||
            !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) {
            invalid();
        }
        snapshot[index] = snapshotElement(descriptor.value);
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

function snapshotRecord<T>(value: unknown, keys: readonly string[]): T {
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
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (
            !descriptor ||
            !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) {
            invalid();
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot) as T;
}

function invalid(): never {
    throw new Error('invalid Xtream capture array');
}
