import {
    createXtreamIterationDefinitions,
    listXtreamBenchmarkScenarios,
    summarizeXtreamNumbers,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import {
    serializeXtreamArtifactForPersistence,
    type XtreamDiagnosticArtifactEvidence,
} from './xtream-diagnostic-artifacts';
import {
    bindXtreamDiagnosticEvidence,
    cloneXtreamSummaryValue,
    copyXtreamDiagnosticProvenance,
} from './xtream-benchmark-summary-evidence';
import {
    assertFreshXtreamProcessIdentities,
    assertOrderedXtreamSchedule,
    freezeDeep,
    isFiniteNonNegative,
    parseXtreamBenchmarkManifest,
    snapshotXtreamIterations,
    toXtreamRawIteration,
} from './xtream-exact-schema';
import { assertXtreamIterationResult } from './xtream-iteration-validity';
import { assertUniqueXtreamPersistencePaths } from './xtream-persistence-schedule';
import { verifyXtreamPersistenceReceipt } from './xtream-raw-persistence-receipt';
import {
    XTREAM_NOT_APPLICABLE,
    XTREAM_RENDERER_VISIBILITY,
    XTREAM_STRUCTURED_CLONE_ATTRIBUTION,
    XTREAM_WORKER_REQUEST_METRIC_SCOPE,
    XTREAM_WORKER_WHOLE_METRIC_SCOPE,
    type NumericDistribution,
    type XtreamArtifactSafetyContext,
    type XtreamBenchmarkManifest,
    type XtreamBenchmarkSummary,
    type XtreamPersistedRawEvidence,
    type XtreamPersistenceReceipt,
    type XtreamRawIterationResult,
    type XtreamScenarioMetrics,
    type XtreamScenarioSummary,
    type XtreamValidatedIterationResult,
} from './xtream-summary-contract';

const VALIDATED = new WeakSet<object>();

export async function persistThenValidateXtreamIteration(
    raw: XtreamRawIterationResult,
    safety: XtreamArtifactSafetyContext,
    persistRaw: (serialized: string) => Promise<XtreamPersistenceReceipt>
): Promise<XtreamValidatedIterationResult> {
    const serialized = serializeXtreamArtifactForPersistence(raw, safety);
    const receipt = await persistRaw(serialized);
    const evidence = await verifyXtreamPersistenceReceipt(serialized, receipt);
    const persisted: unknown = JSON.parse(serialized);
    assertXtreamIterationResult(persisted);
    return brandValidatedIteration(persisted, evidence);
}

export function createXtreamBenchmarkSummary(
    manifest: XtreamBenchmarkManifest,
    iterations: readonly XtreamValidatedIterationResult[],
    diagnosticEvidence: ReadonlyMap<
        XtreamValidatedIterationResult,
        XtreamDiagnosticArtifactEvidence
    >
): XtreamBenchmarkSummary {
    const canonicalManifest = parseXtreamBenchmarkManifest(manifest);
    const expected = createXtreamIterationDefinitions(
        canonicalManifest.mode === 'smoke'
    );
    const canonicalIterations = snapshotXtreamIterations(iterations);
    assertOrderedXtreamSchedule(
        canonicalIterations,
        expected,
        canonicalManifest.mode
    );
    assertFreshXtreamProcessIdentities(canonicalIterations);
    for (const iteration of canonicalIterations) {
        assertValidatedIteration(iteration);
        if (iteration.validationStatus !== 'valid') invalidIteration();
        assertXtreamIterationResult(toXtreamRawIteration(iteration));
    }
    assertUniqueXtreamPersistencePaths(canonicalIterations);
    const boundDiagnosticEvidence = bindXtreamDiagnosticEvidence(
        canonicalIterations,
        diagnosticEvidence
    );

    const measuredRunCount = canonicalManifest.mode === 'formal' ? 5 : 1;
    const comparable =
        canonicalManifest.mode === 'formal' &&
        canonicalIterations
            .filter(({ kind }) => kind === 'measured')
            .every(({ eligibleForComparison }) => eligibleForComparison);
    return freezeDeep({
        iterations: cloneXtreamSummaryValue(canonicalIterations),
        manifest: cloneXtreamSummaryValue(canonicalManifest),
        scenarios: listXtreamBenchmarkScenarios().map(({ id }) =>
            summarizeScenario(
                canonicalIterations,
                id,
                measuredRunCount,
                boundDiagnosticEvidence
            )
        ),
        validForComparison: comparable,
    });
}

function summarizeScenario(
    iterations: readonly XtreamValidatedIterationResult[],
    scenarioId: XtreamScenarioId,
    measuredRunCount: number,
    diagnosticEvidence: ReadonlyMap<
        XtreamValidatedIterationResult,
        XtreamDiagnosticArtifactEvidence
    >
): XtreamScenarioSummary {
    const measured = iterations.filter(
        (iteration) =>
            iteration.scenarioId === scenarioId && iteration.kind === 'measured'
    );
    const diagnostic = iterations.find(
        (iteration) =>
            iteration.scenarioId === scenarioId &&
            iteration.kind === 'diagnostic'
    );
    if (measured.length !== measuredRunCount || !diagnostic) {
        scheduleError(measuredRunCount === 5 ? 'formal' : 'smoke');
    }
    const provenance = diagnosticEvidence.get(diagnostic);
    if (!provenance) invalidIteration();
    const restores =
        scenarioId === 'xtream-refresh-large' ||
        scenarioId === 'xtream-background-ui';
    return {
        scenarioId,
        measuredRuns: measuredRunCount,
        databaseWorkerEventLoopDelayMetricScope:
            XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY,
        databaseWorkerRequestInvalidReasons: [
            ...new Set(
                measured.flatMap((run) =>
                    run.databaseWorker.requests.invalidReasons.map(
                        ({ reason }) => reason
                    )
                )
            ),
        ],
        databaseWorkerRequestMetricScope:
            XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY,
        databaseWorkerWholeWorkerMetricScope:
            XTREAM_WORKER_WHOLE_METRIC_SCOPE.OPERATION_WINDOW,
        dashboardPaintVisibility:
            scenarioId === 'xtream-background-ui'
                ? XTREAM_RENDERER_VISIBILITY.VISIBLE_WITHOUT_OVERLAY
                : null,
        diagnosticProfiles: {
            artifactProvenance: copyXtreamDiagnosticProvenance(provenance),
            databaseWorkerDurationMicros:
                provenance.profiles.databaseWorker.durationMicros,
            mainDurationMicros: provenance.profiles.main.durationMicros,
            rendererDurationMicros: provenance.profiles.renderer.durationMicros,
        },
        metrics: summarizeMetrics(measured, scenarioId, measuredRunCount),
        memory: {
            databaseWorkerRss: notApplicable(
                XTREAM_NOT_APPLICABLE.DATABASE_WORKER_RSS
            ),
            nativeAndSqlite: notApplicable(
                XTREAM_NOT_APPLICABLE.NATIVE_SQLITE_MEMORY
            ),
            playlistRefreshWorker: notApplicable(
                XTREAM_NOT_APPLICABLE.PLAYLIST_REFRESH_WORKER
            ),
        },
        mainEventLoopUtilization: notApplicable(
            XTREAM_NOT_APPLICABLE.MAIN_EVENT_LOOP_UTILIZATION
        ),
        phases: {
            debugCopy: notApplicable(XTREAM_NOT_APPLICABLE.DEBUG_COPY),
            indexes: notApplicable(XTREAM_NOT_APPLICABLE.INDEXES_PRE_EXIST),
            transactionCommit: notApplicable(
                XTREAM_NOT_APPLICABLE.COMMIT_INCLUDED_IN_SQLITE_WRITE
            ),
            restoreUserData: notApplicable(
                restores
                    ? XTREAM_NOT_APPLICABLE.RESTORE_NO_USER_DATA
                    : XTREAM_NOT_APPLICABLE.RESTORE_NOT_INVOKED
            ),
            backgroundSearchMarker:
                scenarioId === 'xtream-background-ui'
                    ? notApplicable(XTREAM_NOT_APPLICABLE.SOURCES_SEARCH_MARKER)
                    : null,
            structuredCloneAttribution:
                XTREAM_STRUCTURED_CLONE_ATTRIBUTION.SELECTED_IPC_PROXY,
        },
        rendererLongTaskCountTotal: sumValues(
            measured,
            (run) => run.renderer.longTaskCount
        ),
        responsiveEventsTotal: sumValues(
            measured,
            (run) => run.main.responsiveEvents
        ),
        unresponsiveEventsTotal: sumValues(
            measured,
            (run) => run.main.unresponsiveEvents
        ),
    };
}

function summarizeMetrics(
    runs: readonly XtreamValidatedIterationResult[],
    scenarioId: XtreamScenarioId,
    count: number
): XtreamScenarioMetrics {
    const metric = (
        select: (run: XtreamValidatedIterationResult) => number
    ): NumericDistribution => distribution(runs, select, count);
    const optional = (
        select: (run: XtreamValidatedIterationResult) => number | null
    ): NumericDistribution =>
        distribution(runs, (run) => requireNumber(select(run)), count);
    return {
        totalMs: metric((run) => run.phases.totalMs),
        dataAcquisitionMs: metric((run) => run.phases.dataAcquisitionMs),
        jsonParsingMs: metric((run) => run.phases.jsonParsingMs),
        normalizationMs: metric((run) => run.phases.normalizationMs),
        serializationMs: metric((run) => run.phases.serializationMs),
        deserializationMs: metric((run) => run.phases.deserializationMs),
        structuredCloneProxyMs: metric(
            (run) => run.phases.structuredCloneProxyMs
        ),
        sqliteReadMs: metric((run) => run.phases.sqliteReadMs),
        sqliteWriteMs: metric((run) => run.phases.sqliteWriteMs),
        storeUpdateMs: metric((run) => run.phases.storeUpdateMs),
        angularRenderingMs: metric((run) => run.phases.angularRenderingMs),
        rendererPeakRssBytes: metric((run) => run.renderer.peakRssBytes),
        rendererPeakHeapBytes: metric((run) => run.renderer.peakHeapUsedBytes),
        rendererPostGcHeapBytes: metric(
            (run) => run.renderer.postGcHeapUsedBytes
        ),
        rendererLongTaskCount: metric((run) => run.renderer.longTaskCount),
        rendererLongTaskMaxMs: metric((run) => run.renderer.longTaskMaxMs),
        rendererFrameGapP95Ms: metric((run) => run.renderer.frameGapP95Ms),
        rendererFrameGapMaxMs: metric((run) => run.renderer.frameGapMaxMs),
        rendererHeartbeatP95Ms: metric((run) => run.renderer.heartbeatP95Ms),
        rendererHeartbeatMaxMs: metric((run) => run.renderer.heartbeatMaxMs),
        rendererNavigationLatencyMs:
            scenarioId === 'xtream-background-ui'
                ? optional((run) => run.renderer.navigationLatencyMs)
                : null,
        rendererSearchLatencyMs:
            scenarioId === 'xtream-background-ui'
                ? optional((run) => run.renderer.searchLatencyMs)
                : null,
        rendererActionLatencyMs:
            scenarioId === 'xtream-background-ui'
                ? optional((run) => run.renderer.actionLatencyMs)
                : null,
        mainCpuUserMicros: metric((run) => run.main.cpuUserMicros),
        mainCpuSystemMicros: metric((run) => run.main.cpuSystemMicros),
        mainPeakRssBytes: metric((run) => run.main.peakRssBytes),
        mainPeakHeapBytes: metric((run) => run.main.peakHeapUsedBytes),
        mainPostGcHeapBytes: metric((run) => run.main.postGcHeapUsedBytes),
        mainEventLoopDelayP95Ms: metric((run) => run.main.eventLoopDelayP95Ms),
        mainEventLoopDelayP99Ms: metric((run) => run.main.eventLoopDelayP99Ms),
        mainEventLoopDelayMaxMs: metric((run) => run.main.eventLoopDelayMaxMs),
        databaseWorkerCpuUserMicros: metric(
            (run) => run.databaseWorker.cpuUserMicros
        ),
        databaseWorkerCpuSystemMicros: metric(
            (run) => run.databaseWorker.cpuSystemMicros
        ),
        databaseWorkerPeakHeapBytes: metric(
            (run) => run.databaseWorker.peakHeapUsedBytes
        ),
        databaseWorkerPostGcHeapBytes: metric(
            (run) => run.databaseWorker.postGcHeapUsedBytes
        ),
        databaseWorkerRequestTotalCount: metric(
            (run) => run.databaseWorker.requests.totalCount
        ),
        databaseWorkerRequestValidSampleCount: metric(
            (run) => run.databaseWorker.requests.validSampleCount
        ),
        databaseWorkerRequestInvalidSampleCount: metric(
            (run) => run.databaseWorker.requests.invalidSampleCount
        ),
        databaseWorkerRequestEventLoopDelayP95Ms: metric(
            (run) => run.databaseWorker.requests.eventLoopDelayP95Ms
        ),
        databaseWorkerRequestEventLoopDelayP99Ms: metric(
            (run) => run.databaseWorker.requests.eventLoopDelayP99Ms
        ),
        databaseWorkerRequestEventLoopDelayMaxMs: metric(
            (run) => run.databaseWorker.requests.eventLoopDelayMaxMs
        ),
        databaseWorkerRequestEventLoopUtilization: metric(
            (run) => run.databaseWorker.requests.eventLoopUtilization
        ),
        databaseWorkerPeakExternalBytes: metric(
            (run) => run.databaseWorker.peakExternalBytes
        ),
        databaseWorkerEventLoopDelayP95Ms: metric(
            (run) => run.databaseWorker.eventLoopDelayP95Ms
        ),
        databaseWorkerEventLoopDelayP99Ms: metric(
            (run) => run.databaseWorker.eventLoopDelayP99Ms
        ),
        databaseWorkerEventLoopDelayMaxMs: metric(
            (run) => run.databaseWorker.eventLoopDelayMaxMs
        ),
        databaseWorkerEventLoopUtilization: metric(
            (run) => run.databaseWorker.eventLoopUtilization
        ),
        cancelAcknowledgementLatencyMs:
            scenarioId === 'xtream-cancel-import'
                ? optional((run) => run.cancellation.acknowledgementLatencyMs)
                : null,
    };
}

function distribution(
    runs: readonly XtreamValidatedIterationResult[],
    select: (run: XtreamValidatedIterationResult) => number,
    expectedCount: number
): NumericDistribution {
    const values = runs.map(select);
    if (
        values.length !== expectedCount ||
        values.some((value) => !isFiniteNonNegative(value))
    ) {
        throw new Error(
            'Xtream metric requires complete finite measured values'
        );
    }
    return summarizeXtreamNumbers(values);
}

function sumValues(
    runs: readonly XtreamValidatedIterationResult[],
    select: (run: XtreamValidatedIterationResult) => number
): number {
    return runs.reduce((total, run) => total + select(run), 0);
}

function requireNumber(value: number | null): number {
    if (!isFiniteNonNegative(value)) invalidIteration();
    return value;
}

function notApplicable(reason: string): { reason: string; value: null } {
    return { reason, value: null };
}

function brandValidatedIteration(
    raw: XtreamRawIterationResult,
    persistence: XtreamPersistedRawEvidence
): XtreamValidatedIterationResult {
    const result = freezeDeep({
        ...raw,
        persistence,
        validationStatus: 'valid' as const,
    });
    VALIDATED.add(result);
    return result;
}

function assertValidatedIteration(value: XtreamValidatedIterationResult): void {
    if (!VALIDATED.has(value)) {
        throw new Error('Xtream validated persistence evidence is missing');
    }
}

function scheduleError(mode: 'formal' | 'smoke'): never {
    throw new Error(
        `Xtream benchmark requires exactly ${mode === 'formal' ? 'five' : 'one'} measured runs per scenario`
    );
}

function invalidIteration(): never {
    throw new Error('invalid Xtream iteration');
}
