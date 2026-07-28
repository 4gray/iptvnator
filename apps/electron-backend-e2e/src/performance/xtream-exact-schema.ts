import {
    XTREAM_ITERATION_KIND,
    type XtreamIterationDefinition,
} from './xtream-benchmark-contract';
import {
    XTREAM_IDENTIFIER,
    XTREAM_SHA256,
} from './xtream-benchmark-manifest-schema';
import {
    XTREAM_NOT_APPLICABLE,
    type XtreamRawIterationResult,
    type XtreamValidatedIterationResult,
} from './xtream-summary-contract';

export {
    assertXtreamBenchmarkManifest,
    parseXtreamBenchmarkManifest,
    XTREAM_IDENTIFIER,
    XTREAM_SHA256,
} from './xtream-benchmark-manifest-schema';

export const XTREAM_RAW_ITERATION_KEYS = [
    'cancellation',
    'cancellationEvidence',
    'catalogVerification',
    'databaseWorker',
    'eligibleForComparison',
    'kind',
    'main',
    'phaseCapture',
    'phases',
    'playlistRefreshWorker',
    'processIdentity',
    'renderer',
    'runId',
    'scenarioId',
    'validity',
] as const;

export const XTREAM_PHASE_NUMBER_KEYS = [
    'angularRenderingMs',
    'dataAcquisitionMs',
    'deserializationMs',
    'jsonParsingMs',
    'normalizationMs',
    'serializationMs',
    'sqliteReadMs',
    'sqliteWriteMs',
    'storeUpdateMs',
    'structuredCloneProxyMs',
    'totalMs',
] as const;

export const XTREAM_PHASE_KEYS = [
    ...XTREAM_PHASE_NUMBER_KEYS,
    'backgroundSearchMarkerMs',
    'backgroundSearchMarkerReason',
    'indexesMs',
    'indexesReason',
    'restoreUserDataMs',
    'restoreUserDataReason',
    'structuredCloneAttribution',
    'transactionCommitMs',
    'transactionCommitReason',
] as const;

export const XTREAM_PROFILE_KEYS = [
    'cpuProfileDurationMicros',
    'cpuProfileUnavailableReason',
] as const;

export const XTREAM_RENDERER_NUMBER_KEYS = [
    'frameGapMaxMs',
    'frameGapP95Ms',
    'heartbeatMaxMs',
    'heartbeatP95Ms',
    'longTaskCount',
    'longTaskMaxMs',
    'peakHeapUsedBytes',
    'peakRssBytes',
    'postGcHeapUsedBytes',
    'storeToPaintMs',
] as const;

export const XTREAM_MAIN_NUMBER_KEYS = [
    'browserWindowId',
    'cpuSystemMicros',
    'cpuUserMicros',
    'eventLoopDelayMaxMs',
    'eventLoopDelayP95Ms',
    'eventLoopDelayP99Ms',
    'peakHeapUsedBytes',
    'peakRssBytes',
    'postGcHeapUsedBytes',
    'responsiveEvents',
    'unresponsiveEvents',
    'webContentsId',
] as const;

export const XTREAM_WORKER_NUMBER_KEYS = [
    'cpuSystemMicros',
    'cpuUserMicros',
    'eventLoopDelayMaxMs',
    'eventLoopDelayP95Ms',
    'eventLoopDelayP99Ms',
    'eventLoopUtilization',
    'ordinal',
    'peakExternalBytes',
    'peakHeapUsedBytes',
    'postGcHeapUsedBytes',
] as const;

export const XTREAM_CANCEL_TIME_KEYS = [
    'acknowledgementLatencyMs',
    'authoritativeTerminalEpochMs',
    'clickEpochMs',
    'clickToDatabaseDispatchMs',
    'clickToPaintMs',
    'clickToPreloadReturnMs',
    'databaseDispatchEpochMs',
    'paintedEpochMs',
    'preloadReturnEpochMs',
    'preloadStartEpochMs',
    'workerReceiptEpochMs',
    'workerReceiptLatencyMs',
] as const;

export function assertFreshXtreamProcessIdentities(
    iterations: readonly XtreamValidatedIterationResult[]
): void {
    const unique = (select: (run: XtreamValidatedIterationResult) => unknown) =>
        new Set(iterations.map(select)).size === iterations.length;
    if (
        !unique((run) => run.processIdentity.electronPid) ||
        !unique((run) => run.processIdentity.launchId) ||
        !unique((run) => run.processIdentity.profileDirectorySha256) ||
        !unique((run) => run.processIdentity.generationIdentitySha256)
    ) {
        throw new Error('Xtream benchmark requires a fresh process identity');
    }
}

export function snapshotXtreamIterations(
    value: unknown
): readonly XtreamValidatedIterationResult[] {
    try {
        if (!Array.isArray(value)) invalidIterationCollection();
        const lengthDescriptor = Reflect.getOwnPropertyDescriptor(
            value,
            'length'
        );
        const length = lengthDescriptor?.value;
        if (
            !Number.isSafeInteger(length) ||
            Number(length) < 0 ||
            Number(length) > 128
        ) {
            invalidIterationCollection();
        }
        const snapshot: XtreamValidatedIterationResult[] = [];
        for (let index = 0; index < Number(length); index += 1) {
            const descriptor = Reflect.getOwnPropertyDescriptor(
                value,
                String(index)
            );
            if (
                !descriptor ||
                !Object.prototype.hasOwnProperty.call(descriptor, 'value')
            ) {
                invalidIterationCollection();
            }
            snapshot.push(descriptor.value as XtreamValidatedIterationResult);
        }
        return Object.freeze(snapshot);
    } catch {
        throw new Error('invalid Xtream iteration collection');
    }
}

export function assertOrderedXtreamSchedule(
    iterations: readonly XtreamValidatedIterationResult[],
    expected: readonly XtreamIterationDefinition[],
    mode: 'formal' | 'smoke'
): void {
    if (iterations.length !== expected.length) scheduleError(mode);
    for (let index = 0; index < expected.length; index += 1) {
        const actual = iterations[index];
        const definition = expected[index];
        assertXtreamSafePathIdentifier(actual?.runId, 'run-id');
        assertXtreamSafePathIdentifier(definition?.runId, 'run-id');
        if (
            !actual ||
            !definition ||
            actual.scenarioId !== definition.scenarioId ||
            actual.runId !== definition.runId ||
            actual.kind !== definition.kind ||
            actual.eligibleForComparison !== definition.eligibleForComparison
        ) {
            throw new Error('invalid ordered Xtream benchmark schedule');
        }
    }
}

export function assertXtreamSafePathIdentifier(
    value: unknown,
    label: string
): asserts value is string {
    if (typeof value !== 'string' || !XTREAM_IDENTIFIER.test(value)) {
        throw new Error(`benchmark requires a safe Xtream ${label}`);
    }
}

export function toXtreamRawIteration(
    value: XtreamValidatedIterationResult
): XtreamRawIterationResult {
    const raw: Record<string, unknown> = { ...value };
    delete raw['persistence'];
    delete raw['validationStatus'];
    return raw as unknown as XtreamRawIterationResult;
}

export function freezeDeep<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(freezeDeep);
    }
    return value;
}

export function isExactRecord(
    value: unknown,
    keys: readonly string[]
): value is Record<string, unknown> {
    try {
        if (
            typeof value !== 'object' ||
            value === null ||
            Array.isArray(value) ||
            ![Object.prototype, null].includes(Reflect.getPrototypeOf(value))
        ) {
            return false;
        }
        const ownKeys = Reflect.ownKeys(value);
        if (
            ownKeys.length !== keys.length ||
            ownKeys.some(
                (key) => typeof key !== 'string' || !keys.includes(key)
            )
        ) {
            return false;
        }
        return keys.every((key) => {
            const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
            return (
                descriptor !== undefined &&
                Object.prototype.hasOwnProperty.call(descriptor, 'value')
            );
        });
    } catch {
        return false;
    }
}

export function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isSafeNonNegativeInteger(value: unknown): boolean {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isPositiveSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

export function isUtilization(value: unknown): boolean {
    return isFiniteNonNegative(value) && value <= 1;
}

export function hasFiniteNonNegativeKeys(
    value: Record<string, unknown>,
    keys: readonly string[]
): boolean {
    return keys.every((key) => isFiniteNonNegative(value[key]));
}

export function hasOrderedEventLoopDelay(
    value: Record<string, unknown>
): boolean {
    return (
        (value['eventLoopDelayP95Ms'] as number) <=
            (value['eventLoopDelayP99Ms'] as number) &&
        (value['eventLoopDelayP99Ms'] as number) <=
            (value['eventLoopDelayMaxMs'] as number)
    );
}

export function hasMatchingEventLoopDelay(
    worker: Record<string, unknown>
): boolean {
    const requests = worker['requests'];
    if (typeof requests !== 'object' || requests === null) return false;
    return [
        'eventLoopDelayMaxMs',
        'eventLoopDelayP95Ms',
        'eventLoopDelayP99Ms',
    ].every(
        (key) => worker[key] === (requests as Record<string, unknown>)[key]
    );
}

export function isExactXtreamProcessIdentity(value: unknown): boolean {
    const keys = [
        'captureGeneration',
        'electronPid',
        'freshProcess',
        'generationIdentitySha256',
        'launchId',
        'profileDirectorySha256',
    ] as const;
    return (
        isExactRecord(value, keys) &&
        isPositiveSafeInteger(value['captureGeneration']) &&
        isPositiveSafeInteger(value['electronPid']) &&
        value['freshProcess'] === true &&
        typeof value['launchId'] === 'string' &&
        XTREAM_IDENTIFIER.test(value['launchId']) &&
        typeof value['generationIdentitySha256'] === 'string' &&
        XTREAM_SHA256.test(value['generationIdentitySha256']) &&
        typeof value['profileDirectorySha256'] === 'string' &&
        XTREAM_SHA256.test(value['profileDirectorySha256'])
    );
}

export function isXtreamProfile(
    value: Record<string, unknown>,
    kind: unknown
): boolean {
    return kind === XTREAM_ITERATION_KIND.DIAGNOSTIC
        ? isPositiveSafeInteger(value['cpuProfileDurationMicros']) &&
              value['cpuProfileUnavailableReason'] === null
        : value['cpuProfileDurationMicros'] === null &&
              value['cpuProfileUnavailableReason'] ===
                  XTREAM_NOT_APPLICABLE.PROFILE_OUTSIDE_DIAGNOSTIC;
}

export function sameValues(
    left: readonly unknown[],
    right: readonly unknown[]
): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function sameMaps(
    left: ReadonlyMap<string, unknown>,
    right: ReadonlyMap<string, unknown>
): boolean {
    return sameValues([...left.entries()].sort(), [...right.entries()].sort());
}

function scheduleError(mode: 'formal' | 'smoke'): never {
    throw new Error(
        `Xtream benchmark requires exactly ${mode === 'formal' ? 'five' : 'one'} measured runs per scenario`
    );
}

function invalidIterationCollection(): never {
    throw new Error('invalid iteration collection');
}
