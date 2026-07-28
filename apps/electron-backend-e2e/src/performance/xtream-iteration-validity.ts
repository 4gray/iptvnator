import {
    XTREAM_ITERATION_KIND,
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import {
    XTREAM_CANCEL_NETWORK_ABORT_REASON,
    XTREAM_MAIN_CPU_METRIC_SCOPE,
    XTREAM_NOT_APPLICABLE,
    XTREAM_RENDERER_VISIBILITY,
    XTREAM_STRUCTURED_CLONE_ATTRIBUTION,
    XTREAM_WORKER_CPU_METRIC_SCOPE,
    XTREAM_WORKER_REQUEST_METRIC_SCOPE,
    XTREAM_WORKER_WHOLE_METRIC_SCOPE,
    type XtreamRawIterationResult,
} from './xtream-summary-contract';
import {
    hasFiniteNonNegativeKeys,
    hasMatchingEventLoopDelay,
    hasOrderedEventLoopDelay,
    assertXtreamSafePathIdentifier,
    isExactXtreamProcessIdentity,
    isExactRecord,
    isFiniteNonNegative,
    isPositiveSafeInteger,
    isSafeNonNegativeInteger,
    isUtilization,
    isXtreamProfile,
    XTREAM_CANCEL_TIME_KEYS,
    XTREAM_MAIN_NUMBER_KEYS,
    XTREAM_PHASE_KEYS,
    XTREAM_PHASE_NUMBER_KEYS,
    XTREAM_PROFILE_KEYS,
    XTREAM_RAW_ITERATION_KEYS,
    XTREAM_RENDERER_NUMBER_KEYS,
    XTREAM_WORKER_NUMBER_KEYS,
} from './xtream-exact-schema';
import { assertXtreamWorkerHeapWithinMainRss } from './xtream-memory-validity';
import { assertXtreamIterationEvidenceBinding } from './xtream-iteration-evidence-binding';
import { assertXtreamFixedIterationContracts } from './xtream-iteration-fixed-contracts';
import { validXtreamWorkerRequestAccounting } from './xtream-worker-request-evidence';

export function assertXtreamIterationResult(
    input: unknown
): asserts input is XtreamRawIterationResult {
    try {
        if (!isExactRecord(input, XTREAM_RAW_ITERATION_KEYS)) invalid();
        assertDefinition(input);
        assertPhases(input['phases'], input['scenarioId']);
        assertRenderer(input['renderer'], input);
        assertMain(input['main'], input['kind']);
        assertWorker(
            input['databaseWorker'],
            input['kind'],
            input['scenarioId'] as XtreamScenarioId
        );
        assertXtreamWorkerHeapWithinMainRss(
            input['databaseWorker'],
            input['main']
        );
        assertProcessIdentity(input['processIdentity']);
        assertCancellation(input['cancellation'], input['scenarioId']);
        assertXtreamFixedIterationContracts(input);
        assertXtreamIterationEvidenceBinding(
            input as unknown as XtreamRawIterationResult
        );
    } catch {
        throw new Error('invalid Xtream iteration');
    }
}

function assertDefinition(value: Record<string, unknown>): void {
    if (
        !Object.values(XTREAM_SCENARIO_ID).includes(
            value['scenarioId'] as never
        ) ||
        !Object.values(XTREAM_ITERATION_KIND).includes(
            value['kind'] as never
        ) ||
        typeof value['eligibleForComparison'] !== 'boolean' ||
        (value['kind'] !== XTREAM_ITERATION_KIND.MEASURED &&
            value['eligibleForComparison'])
    ) {
        invalid();
    }
    assertXtreamSafePathIdentifier(value['runId'], 'run-id');
}

function assertPhases(value: unknown, scenarioId: unknown): void {
    if (
        !isExactRecord(value, XTREAM_PHASE_KEYS) ||
        !hasFiniteNonNegativeKeys(value, XTREAM_PHASE_NUMBER_KEYS)
    ) {
        invalid();
    }
    const background = scenarioId === XTREAM_SCENARIO_ID.BACKGROUND_UI;
    const restores =
        background || scenarioId === XTREAM_SCENARIO_ID.REFRESH_LARGE;
    if (
        (value['totalMs'] as number) <= 0 ||
        (value['angularRenderingMs'] as number) <= 0 ||
        value['indexesMs'] !== null ||
        value['indexesReason'] !== XTREAM_NOT_APPLICABLE.INDEXES_PRE_EXIST ||
        value['transactionCommitMs'] !== null ||
        value['transactionCommitReason'] !==
            XTREAM_NOT_APPLICABLE.COMMIT_INCLUDED_IN_SQLITE_WRITE ||
        value['structuredCloneAttribution'] !==
            XTREAM_STRUCTURED_CLONE_ATTRIBUTION.SELECTED_IPC_PROXY ||
        value['restoreUserDataMs'] !== null ||
        value['restoreUserDataReason'] !==
            (restores
                ? XTREAM_NOT_APPLICABLE.RESTORE_NO_USER_DATA
                : XTREAM_NOT_APPLICABLE.RESTORE_NOT_INVOKED) ||
        value['backgroundSearchMarkerMs'] !== null ||
        value['backgroundSearchMarkerReason'] !==
            (background ? XTREAM_NOT_APPLICABLE.SOURCES_SEARCH_MARKER : null) ||
        XTREAM_PHASE_NUMBER_KEYS.some(
            (key) => (value[key] as number) > (value['totalMs'] as number)
        ) ||
        (scenarioId === XTREAM_SCENARIO_ID.DELETE_LARGE &&
            (value['dataAcquisitionMs'] !== 0 ||
                value['jsonParsingMs'] !== 0 ||
                value['normalizationMs'] !== 0 ||
                value['deserializationMs'] !== 0))
    ) {
        invalid();
    }
}

function assertRenderer(value: unknown, raw: Record<string, unknown>): void {
    const keys = [
        ...XTREAM_PROFILE_KEYS,
        ...XTREAM_RENDERER_NUMBER_KEYS,
        'actionLatencyMs',
        'consoleErrors',
        'dashboardPaintVisibility',
        'navigationLatencyMs',
        'searchLatencyMs',
        'targetId',
    ] as const;
    if (
        !isExactRecord(value, keys) ||
        !hasFiniteNonNegativeKeys(value, XTREAM_RENDERER_NUMBER_KEYS) ||
        !isXtreamProfile(value, raw['kind']) ||
        !isSafeNonNegativeInteger(value['longTaskCount']) ||
        typeof value['targetId'] !== 'string' ||
        value['targetId'].length === 0 ||
        !Array.isArray(value['consoleErrors']) ||
        value['consoleErrors'].length !== 0 ||
        value['storeToPaintMs'] !==
            (raw['phases'] as Record<string, unknown>)['angularRenderingMs'] ||
        (value['frameGapP95Ms'] as number) >
            (value['frameGapMaxMs'] as number) ||
        (value['heartbeatP95Ms'] as number) >
            (value['heartbeatMaxMs'] as number) ||
        (value['peakHeapUsedBytes'] as number) <= 0 ||
        (value['peakRssBytes'] as number) <= 0 ||
        (value['postGcHeapUsedBytes'] as number) <= 0 ||
        (value['postGcHeapUsedBytes'] as number) >
            (value['peakHeapUsedBytes'] as number) ||
        (value['peakHeapUsedBytes'] as number) >
            (value['peakRssBytes'] as number) ||
        (value['longTaskCount'] === 0) !== (value['longTaskMaxMs'] === 0)
    ) {
        invalid();
    }
    const background = raw['scenarioId'] === XTREAM_SCENARIO_ID.BACKGROUND_UI;
    const optional = [
        value['navigationLatencyMs'],
        value['searchLatencyMs'],
        value['actionLatencyMs'],
    ];
    if (
        (background &&
            (value['dashboardPaintVisibility'] !==
                XTREAM_RENDERER_VISIBILITY.VISIBLE_WITHOUT_OVERLAY ||
                !optional.every(isFiniteNonNegative))) ||
        (!background &&
            (value['dashboardPaintVisibility'] !== null ||
                optional.some((entry) => entry !== null)))
    ) {
        invalid();
    }
}

function assertMain(value: unknown, kind: unknown): void {
    const keys = [
        ...XTREAM_PROFILE_KEYS,
        ...XTREAM_MAIN_NUMBER_KEYS,
        'cpuMetricScope',
        'eventLoopUtilization',
        'eventLoopUtilizationUnavailableReason',
    ] as const;
    if (
        !isExactRecord(value, keys) ||
        !hasFiniteNonNegativeKeys(value, XTREAM_MAIN_NUMBER_KEYS) ||
        !isXtreamProfile(value, kind) ||
        !isPositiveSafeInteger(value['browserWindowId']) ||
        !isPositiveSafeInteger(value['webContentsId']) ||
        !isSafeNonNegativeInteger(value['responsiveEvents']) ||
        !isSafeNonNegativeInteger(value['unresponsiveEvents']) ||
        value['eventLoopUtilization'] !== null ||
        value['eventLoopUtilizationUnavailableReason'] !==
            XTREAM_NOT_APPLICABLE.MAIN_EVENT_LOOP_UTILIZATION ||
        value['cpuMetricScope'] !==
            XTREAM_MAIN_CPU_METRIC_SCOPE.ELECTRON_MAIN_THREAD ||
        !hasOrderedEventLoopDelay(value) ||
        (value['peakHeapUsedBytes'] as number) <= 0 ||
        (value['peakRssBytes'] as number) <= 0 ||
        (value['postGcHeapUsedBytes'] as number) <= 0 ||
        (value['postGcHeapUsedBytes'] as number) >
            (value['peakHeapUsedBytes'] as number) ||
        (value['peakHeapUsedBytes'] as number) >
            (value['peakRssBytes'] as number)
    ) {
        invalid();
    }
}

function assertWorker(
    value: unknown,
    kind: unknown,
    scenarioId: XtreamScenarioId
): void {
    const keys = [
        ...XTREAM_PROFILE_KEYS,
        ...XTREAM_WORKER_NUMBER_KEYS,
        'cpuMetricScope',
        'currentForCapture',
        'eventLoopDelayMetricScope',
        'kind',
        'requests',
        'rssBytes',
        'rssUnavailableReason',
        'wholeWorkerMetricScope',
    ] as const;
    if (
        !isExactRecord(value, keys) ||
        !hasFiniteNonNegativeKeys(value, XTREAM_WORKER_NUMBER_KEYS) ||
        !isXtreamProfile(value, kind) ||
        value['kind'] !== 'database.worker' ||
        value['cpuMetricScope'] !==
            XTREAM_WORKER_CPU_METRIC_SCOPE.SUM_VALID_REQUEST_WORK ||
        value['currentForCapture'] !== true ||
        !isPositiveSafeInteger(value['ordinal']) ||
        !isUtilization(value['eventLoopUtilization']) ||
        !hasOrderedEventLoopDelay(value) ||
        !validXtreamWorkerRequestAccounting(value['requests'], scenarioId) ||
        !hasMatchingEventLoopDelay(value) ||
        value['eventLoopDelayMetricScope'] !==
            XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY ||
        value['wholeWorkerMetricScope'] !==
            XTREAM_WORKER_WHOLE_METRIC_SCOPE.OPERATION_WINDOW ||
        value['rssBytes'] !== null ||
        value['rssUnavailableReason'] !==
            XTREAM_NOT_APPLICABLE.DATABASE_WORKER_RSS ||
        (value['peakHeapUsedBytes'] as number) <= 0 ||
        (value['postGcHeapUsedBytes'] as number) <= 0 ||
        (value['postGcHeapUsedBytes'] as number) >
            (value['peakHeapUsedBytes'] as number)
    ) {
        invalid();
    }
}

function assertProcessIdentity(value: unknown): void {
    if (!isExactXtreamProcessIdentity(value)) invalid();
}

function assertCancellation(value: unknown, scenarioId: unknown): void {
    const keys = [
        ...XTREAM_CANCEL_TIME_KEYS,
        'authoritativeDatabaseAcknowledgementObserved',
        'failedDatabaseRequestId',
        'failedOperationId',
        'mainNetworkAbortObserved',
        'mainNetworkAbortReason',
        'workerReceiptIsAuthoritative',
    ] as const;
    if (!isExactRecord(value, keys)) invalid();
    const cancel = scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT;
    if (!cancel) {
        if (
            XTREAM_CANCEL_TIME_KEYS.some((key) => value[key] !== null) ||
            value['authoritativeDatabaseAcknowledgementObserved'] !== false ||
            value['failedDatabaseRequestId'] !== null ||
            value['failedOperationId'] !== null ||
            value['mainNetworkAbortObserved'] !== false ||
            value['mainNetworkAbortReason'] !== null ||
            value['workerReceiptIsAuthoritative'] !== false
        ) {
            invalid();
        }
        return;
    }
    if (
        !XTREAM_CANCEL_TIME_KEYS.every((key) =>
            isFiniteNonNegative(value[key])
        ) ||
        value['authoritativeDatabaseAcknowledgementObserved'] !== true ||
        typeof value['failedDatabaseRequestId'] !== 'string' ||
        value['failedDatabaseRequestId'].length === 0 ||
        typeof value['failedOperationId'] !== 'string' ||
        value['failedOperationId'].length === 0 ||
        value['mainNetworkAbortObserved'] !== false ||
        value['mainNetworkAbortReason'] !==
            XTREAM_CANCEL_NETWORK_ABORT_REASON.AFTER_NETWORK_COMPLETE ||
        value['workerReceiptIsAuthoritative'] !== false
    ) {
        invalid();
    }
    const click = value['clickEpochMs'] as number;
    const preloadStart = value['preloadStartEpochMs'] as number;
    const databaseDispatch = value['databaseDispatchEpochMs'] as number;
    const preloadReturn = value['preloadReturnEpochMs'] as number;
    const workerReceipt = value['workerReceiptEpochMs'] as number;
    const authoritativeTerminal = value[
        'authoritativeTerminalEpochMs'
    ] as number;
    const painted = value['paintedEpochMs'] as number;
    if (
        click > preloadStart ||
        preloadStart > databaseDispatch ||
        databaseDispatch > preloadReturn ||
        databaseDispatch > workerReceipt ||
        workerReceipt > authoritativeTerminal ||
        authoritativeTerminal > painted ||
        !derived(
            value,
            'clickToDatabaseDispatchMs',
            'databaseDispatchEpochMs'
        ) ||
        !derived(value, 'clickToPreloadReturnMs', 'preloadReturnEpochMs') ||
        !derived(value, 'workerReceiptLatencyMs', 'workerReceiptEpochMs') ||
        !derived(
            value,
            'acknowledgementLatencyMs',
            'authoritativeTerminalEpochMs'
        ) ||
        !derived(value, 'clickToPaintMs', 'paintedEpochMs')
    ) {
        invalid();
    }
}

function derived(
    value: Record<string, unknown>,
    latency: string,
    epoch: string
): boolean {
    return (
        Math.abs(
            (value[latency] as number) -
                ((value[epoch] as number) - (value['clickEpochMs'] as number))
        ) <= 0.001
    );
}

function invalid(): never {
    throw new Error('invalid');
}
