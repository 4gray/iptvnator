import type { M3uImportRendererCaptureMetrics } from './m3u-import-renderer-capture';
import type { M3uImportScenarioId } from './m3u-import-benchmark-contract';
import type {
    MainCaptureMetrics,
    NumericDistribution,
    PerformanceIterationKind,
    WorkerCaptureMetrics,
    WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';
import {
    PERFORMANCE_ITERATION_KIND,
    PERFORMANCE_WORKER_KIND,
} from './m3u-refresh-cancellation-contract';
import {
    deriveM3uImportPhaseMetrics,
    M3U_IMPORT_INDEX_COMMIT_UNAVAILABLE_REASON,
} from './m3u-import-report';
import { summarizeNumbers } from './performance-statistics';
import { assessDatabaseWorkerPeakMemoryValidity } from './database-worker-peak-memory-validity';
import { assessDatabaseWorkerPostGcValidity } from './database-worker-post-gc-validity';
import { assessDatabaseWorkerRequestMetricsValidity } from './database-worker-request-metrics-validity';
import { assessRendererRssValidity } from './renderer-rss-validity';
import type {
    M3uImportBenchmarkManifest,
    M3uImportBenchmarkSummary,
    M3uImportIterationResult,
} from './m3u-import-summary-contract';

export type {
    M3uImportBenchmarkManifest,
    M3uImportBenchmarkSummary,
    M3uImportIterationResult,
    M3uImportMeasuredSummary,
} from './m3u-import-summary-contract';

export function createM3uImportIterationResult(input: {
    readonly channelCount: number;
    readonly fixtureBytes: number;
    readonly kind: PerformanceIterationKind;
    readonly main: MainCaptureMetrics;
    readonly renderer: M3uImportRendererCaptureMetrics;
    readonly runId: string;
    readonly scenarioId: M3uImportScenarioId;
}): M3uImportIterationResult {
    return Object.freeze({
        channelCount: input.channelCount,
        fixtureBytes: input.fixtureBytes,
        kind: input.kind,
        main: input.main,
        phases: deriveM3uImportPhaseMetrics(input),
        renderer: input.renderer,
        runId: input.runId,
        scenarioId: input.scenarioId,
    });
}

export function createM3uImportBenchmarkSummary(
    manifest: M3uImportBenchmarkManifest,
    iterations: readonly M3uImportIterationResult[]
): M3uImportBenchmarkSummary {
    validateIterationSchedule(manifest, iterations);
    const measured = iterations.filter(
        (iteration) => iteration.kind === PERFORMANCE_ITERATION_KIND.MEASURED
    );
    validateMeasuredIterations(manifest, measured);
    const values = (
        select: (iteration: M3uImportIterationResult) => number | null
    ): NumericDistribution => summarizeNumbers(measured.map(select));
    const rendererSamples = (
        select: (
            probe: M3uImportRendererCaptureMetrics['probe']
        ) => readonly number[]
    ): NumericDistribution =>
        summarizeNumbers(
            measured.flatMap((iteration) => [
                ...select(iteration.renderer.probe),
            ])
        );
    const databaseWorkers = measured.map(requireDatabaseWorker);
    const databaseRequestPairs = databaseWorkers.map(
        requireInitialImportRequests
    );
    const databaseUpserts = databaseRequestPairs.map((pair) => pair.upsert);
    const databaseGets = databaseRequestPairs.map((pair) => pair.get);
    const databaseRequests = databaseRequestPairs.flatMap((pair) => [
        pair.upsert,
        pair.get,
    ]);

    return Object.freeze({
        iterations: Object.freeze([...iterations]),
        manifest,
        measured: Object.freeze({
            angularRenderingMs: values(
                (iteration) => iteration.phases.angularRenderingMs
            ),
            dataAcquireMs: values(
                (iteration) => iteration.phases.dataAcquireMs
            ),
            databaseWorkerGetEventLoopDelayMaxMs: summarizeNumbers(
                databaseGets.map((request) => request.eventLoopDelay?.maxMs)
            ),
            databaseWorkerGetEventLoopDelayP95Ms: summarizeNumbers(
                databaseGets.map((request) => request.eventLoopDelay?.p95Ms)
            ),
            databaseWorkerGetEventLoopDelayP99Ms: summarizeNumbers(
                databaseGets.map((request) => request.eventLoopDelay?.p99Ms)
            ),
            databaseWorkerGetEventLoopUtilization: summarizeNumbers(
                databaseGets.map((request) => request.eventLoopUtilization)
            ),
            databaseWorkerGetThreadCpuSystemMicros: summarizeNumbers(
                databaseGets.map((request) => request.threadCpuSystemMicros)
            ),
            databaseWorkerGetThreadCpuUserMicros: summarizeNumbers(
                databaseGets.map((request) => request.threadCpuUserMicros)
            ),
            databaseWorkerEventLoopDelayMaxMs: summarizeNumbers(
                databaseRequests.map((request) => request.eventLoopDelay?.maxMs)
            ),
            databaseWorkerEventLoopDelayP95Ms: summarizeNumbers(
                databaseRequests.map((request) => request.eventLoopDelay?.p95Ms)
            ),
            databaseWorkerEventLoopDelayP99Ms: summarizeNumbers(
                databaseRequests.map((request) => request.eventLoopDelay?.p99Ms)
            ),
            databaseWorkerEventLoopUtilization: summarizeNumbers(
                databaseRequests.map((request) => request.eventLoopUtilization)
            ),
            databaseWorkerExternalPeakBytes: summarizeNumbers(
                databaseWorkers.map((worker) => worker.peakExternalBytes)
            ),
            databaseWorkerHeapPeakBytes: summarizeNumbers(
                databaseWorkers.map((worker) => worker.peakHeapUsedBytes)
            ),
            databaseWorkerPostGcHeapBytes: summarizeNumbers(
                databaseWorkers.map((worker) => worker.postGcHeapUsedBytes)
            ),
            databaseWorkerThreadCpuSystemMicros: summarizeNumbers(
                databaseRequestPairs.map((pair) =>
                    sumRequestMetric(
                        pair.upsert.threadCpuSystemMicros,
                        pair.get.threadCpuSystemMicros
                    )
                )
            ),
            databaseWorkerThreadCpuUserMicros: summarizeNumbers(
                databaseRequestPairs.map((pair) =>
                    sumRequestMetric(
                        pair.upsert.threadCpuUserMicros,
                        pair.get.threadCpuUserMicros
                    )
                )
            ),
            databaseWorkerToMainCloneProxyMs: values(
                (iteration) =>
                    iteration.phases.databaseWorkerToMainCloneProxyMs
            ),
            databaseWorkerUpsertEventLoopDelayMaxMs: summarizeNumbers(
                databaseUpserts.map((request) => request.eventLoopDelay?.maxMs)
            ),
            databaseWorkerUpsertEventLoopDelayP95Ms: summarizeNumbers(
                databaseUpserts.map((request) => request.eventLoopDelay?.p95Ms)
            ),
            databaseWorkerUpsertEventLoopDelayP99Ms: summarizeNumbers(
                databaseUpserts.map((request) => request.eventLoopDelay?.p99Ms)
            ),
            databaseWorkerUpsertEventLoopUtilization: summarizeNumbers(
                databaseUpserts.map((request) => request.eventLoopUtilization)
            ),
            databaseWorkerUpsertThreadCpuSystemMicros: summarizeNumbers(
                databaseUpserts.map(
                    (request) => request.threadCpuSystemMicros
                )
            ),
            databaseWorkerUpsertThreadCpuUserMicros: summarizeNumbers(
                databaseUpserts.map((request) => request.threadCpuUserMicros)
            ),
            ipcStructuredCloneProxyMs: values(
                (iteration) => iteration.phases.ipcStructuredCloneProxyMs
            ),
            mainToDatabaseWorkerCloneProxyMs: values(
                (iteration) => iteration.phases.mainToDatabaseWorkerCloneProxyMs
            ),
            mainToRendererCloneProxyMs: values(
                (iteration) => iteration.phases.mainToRendererCloneProxyMs
            ),
            m3uParsingMs: values((iteration) => iteration.phases.m3uParsingMs),
            mainEventLoopDelayMaxMs: values(
                (iteration) => iteration.main.eventLoopDelay.maxMs
            ),
            mainEventLoopDelayP95Ms: values(
                (iteration) => iteration.main.eventLoopDelay.p95Ms
            ),
            mainEventLoopDelayP99Ms: values(
                (iteration) => iteration.main.eventLoopDelay.p99Ms
            ),
            mainEventLoopUtilization: values(
                (iteration) => iteration.main.eventLoopUtilization
            ),
            mainHeapPeakBytes: values(
                (iteration) => iteration.main.memory.peakHeapUsedBytes
            ),
            mainHeapPostGcBytes: values(
                (iteration) => iteration.main.memory.postGcHeapUsedBytes
            ),
            mainRssPeakBytes: values(
                (iteration) => iteration.main.memory.peakRssBytes
            ),
            mainRssPostGcBytes: values(
                (iteration) => iteration.main.memory.postGcRssBytes
            ),
            normalizationMs: values(
                (iteration) => iteration.phases.normalizationMs
            ),
            playlistDeserializationMs: values(
                (iteration) => iteration.phases.playlistDeserializationMs
            ),
            playlistSerializationMs: values(
                (iteration) => iteration.phases.playlistSerializationMs
            ),
            rendererFrameGapMs: rendererSamples((probe) => probe.frameGapsMs),
            rendererHeartbeatDelayMs: rendererSamples(
                (probe) => probe.heartbeatDelaysMs
            ),
            rendererHeapPeakBytes: values(
                (iteration) => iteration.renderer.peakHeapUsedBytes
            ),
            rendererHeapPostGcBytes: values(
                (iteration) => iteration.renderer.postGcHeapUsedBytes
            ),
            rendererLongTaskCount: measured.reduce(
                (total, iteration) =>
                    total + iteration.renderer.probe.longTasksMs.length,
                0
            ),
            rendererLongTaskMs: rendererSamples((probe) => probe.longTasksMs),
            rendererRssPeakBytes: values(
                (iteration) => iteration.main.rendererWindow.rss.peakRssBytes
            ),
            rendererToMainCloneProxyMs: values(
                (iteration) => iteration.phases.rendererToMainCloneProxyMs
            ),
            responsiveEvents: measured.reduce(
                (total, iteration) =>
                    total + iteration.main.rendererWindow.responsiveEvents,
                0
            ),
            sqliteReadMs: values((iteration) => iteration.phases.sqliteReadMs),
            sqliteWriteMs: values(
                (iteration) => iteration.phases.sqliteWriteMs
            ),
            storeImportDispatchMs: values(
                (iteration) => iteration.phases.storeImportDispatchMs
            ),
            storePublishChannelsMs: values(
                (iteration) => iteration.phases.storePublishChannelsMs
            ),
            storeUpdateMs: values(
                (iteration) => iteration.phases.storeUpdateMs
            ),
            totalMs: values((iteration) => iteration.phases.totalMs),
            unresponsiveEvents: measured.reduce(
                (total, iteration) =>
                    total + iteration.main.rendererWindow.unresponsiveEvents,
                0
            ),
        }),
        notApplicable: Object.freeze({
            cancelAcknowledgementLatencyMs: 'scenario-has-no-cancellation',
            databaseWorkerRss: 'unavailable-per-worker-thread',
            indexAndCommitMs: M3U_IMPORT_INDEX_COMMIT_UNAVAILABLE_REASON,
            nativeAndSqliteMemory:
                'included-in-main-rss-not-separately-attributable',
            playlistRefreshWorker: 'not-used-by-initial-import',
        }),
        validity: Object.freeze({
            databaseWorkerPeakMemory:
                assessDatabaseWorkerPeakMemoryValidity(iterations),
            databaseWorkerPostGc:
                assessDatabaseWorkerPostGcValidity(iterations),
            databaseWorkerRequestMetrics:
                assessDatabaseWorkerRequestMetricsValidity(iterations),
            rendererRss: assessRendererRssValidity(iterations),
        }),
    });
}

function validateIterationSchedule(
    manifest: M3uImportBenchmarkManifest,
    iterations: readonly M3uImportIterationResult[]
): void {
    const warmupCount = iterations.filter(
        (iteration) => iteration.kind === PERFORMANCE_ITERATION_KIND.WARMUP
    ).length;
    const measuredCount = iterations.filter(
        (iteration) => iteration.kind === PERFORMANCE_ITERATION_KIND.MEASURED
    ).length;
    const diagnosticCount = iterations.filter(
        (iteration) => iteration.kind === PERFORMANCE_ITERATION_KIND.DIAGNOSTIC
    ).length;
    if (
        warmupCount !== manifest.warmupRuns ||
        measuredCount !== manifest.measuredRuns ||
        diagnosticCount !== 1 ||
        iterations.length !== warmupCount + measuredCount + diagnosticCount ||
        new Set(iterations.map((iteration) => iteration.runId)).size !==
            iterations.length ||
        iterations.some(
            (iteration) =>
                iteration.channelCount !== manifest.channelCount ||
                iteration.fixtureBytes !== manifest.fixtureBytes ||
                iteration.scenarioId !== manifest.scenario
        )
    ) {
        throw new Error('m3u-import-summary-schedule-invalid');
    }
}

function validateMeasuredIterations(
    manifest: M3uImportBenchmarkManifest,
    measured: readonly M3uImportIterationResult[]
): void {
    if (
        measured.length !== manifest.measuredRuns ||
        new Set(measured.map((iteration) => iteration.runId)).size !==
            measured.length ||
        measured.some(
            (iteration) =>
                iteration.channelCount !== manifest.channelCount ||
                iteration.fixtureBytes !== manifest.fixtureBytes ||
                iteration.scenarioId !== manifest.scenario
        )
    ) {
        throw new Error('m3u-import-summary-measured-runs-invalid');
    }
}

function requireDatabaseWorker(
    iteration: M3uImportIterationResult
): WorkerCaptureMetrics {
    const databaseWorkers = iteration.main.workers.filter(
        (worker) => worker.kind === PERFORMANCE_WORKER_KIND.DATABASE
    );
    if (databaseWorkers.length !== 1 || !databaseWorkers[0]) {
        throw new Error('m3u-import-summary-database-worker-invalid');
    }
    return databaseWorkers[0];
}

function requireInitialImportRequests(
    worker: WorkerCaptureMetrics
): {
    readonly get: WorkerRequestPerformanceMetrics;
    readonly upsert: WorkerRequestPerformanceMetrics;
} {
    const upserts = worker.requests.filter(
        (request) =>
            request.operation === 'DB_UPSERT_APP_PLAYLIST' && request.success
    );
    const gets = worker.requests.filter(
        (request) =>
            request.operation === 'DB_GET_APP_PLAYLIST' && request.success
    );
    if (
        worker.requests.length !== 2 ||
        upserts.length !== 1 ||
        !upserts[0] ||
        gets.length !== 1 ||
        !gets[0]
    ) {
        throw new Error('m3u-import-summary-database-request-invalid');
    }
    return { get: gets[0], upsert: upserts[0] };
}

function sumRequestMetric(
    first: number | null,
    second: number | null
): number | null {
    return first === null || second === null ? null : first + second;
}
