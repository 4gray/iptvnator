/* eslint-disable max-lines -- Summary distributions and correlated phase derivation share one auditable schema mapping. */
import type {
    CancellationBenchmarkManifest,
    CancellationBenchmarkSummary,
    CancellationIterationResult,
    CancellationPhaseMetrics,
    MainCaptureMetrics,
    MainTimelineRecord,
    NumericDistribution,
    PerformanceWorkerKind,
    RendererCaptureMetrics,
    WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';
import {
    PERFORMANCE_ITERATION_KIND,
    PERFORMANCE_WORKER_KIND,
} from './m3u-refresh-cancellation-contract';
import {
    nonNegativeDifference,
    summarizeNumbers,
} from './performance-statistics';
import { assessDatabaseWorkerPostGcValidity } from './database-worker-post-gc-validity';

export function createCancellationIterationResult(input: {
    readonly kind: CancellationIterationResult['kind'];
    readonly main: MainCaptureMetrics;
    readonly renderer: RendererCaptureMetrics;
    readonly runId: string;
}): CancellationIterationResult {
    const { main, renderer } = input;
    const phases = derivePhases(main, renderer);
    const cancellationEffectObserved = renderer.probe.events.some(
        (event) => event.status === 'cancelled'
    );

    return Object.freeze({
        cancellationEffectObserved,
        kind: input.kind,
        main,
        phases,
        renderer,
        runId: input.runId,
    });
}

export function createCancellationBenchmarkSummary(
    manifest: CancellationBenchmarkManifest,
    iterations: readonly CancellationIterationResult[]
): CancellationBenchmarkSummary {
    const measured = iterations.filter(
        (iteration) => iteration.kind === PERFORMANCE_ITERATION_KIND.MEASURED
    );
    const flattenRenderer = (
        select: (iteration: CancellationIterationResult) => readonly number[]
    ): number[] => measured.flatMap((iteration) => [...select(iteration)]);
    const workerMetric = (
        kind: PerformanceWorkerKind,
        select: (worker: MainCaptureMetrics['workers'][number]) => number | null
    ): NumericDistribution =>
        summarizeNumbers(
            measured.flatMap((iteration) =>
                iteration.main.workers
                    .filter((worker) => worker.kind === kind)
                    .map((worker) => select(worker))
            )
        );
    const workerRequestMetric = (
        kind: PerformanceWorkerKind,
        select: (request: WorkerRequestPerformanceMetrics) => number | null
    ): NumericDistribution =>
        summarizeNumbers(
            measured.flatMap((iteration) =>
                iteration.main.workers
                    .filter((worker) => worker.kind === kind)
                    .flatMap((worker) =>
                        worker.requests.map((request) => select(request))
                    )
            )
        );
    const workerRequestEventLoopDelayMetric = (
        kind: PerformanceWorkerKind,
        percentile: keyof NonNullable<
            WorkerRequestPerformanceMetrics['eventLoopDelay']
        >
    ): NumericDistribution =>
        workerRequestMetric(
            kind,
            (request) => request.eventLoopDelay?.[percentile] ?? null
        );

    return Object.freeze({
        cancellationEffectRate:
            measured.length === 0
                ? 0
                : measured.filter(
                      (iteration) => iteration.cancellationEffectObserved
                  ).length / measured.length,
        iterations: Object.freeze([...iterations]),
        manifest,
        measured: Object.freeze({
            cancelAcknowledgementLatencyMs: summarizeNumbers(
                measured.map(
                    (iteration) =>
                        iteration.phases.cancelAcknowledgementLatencyMs
                )
            ),
            cancelToDurableTerminalMs: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.phases.cancelToDurableTerminalMs
                )
            ),
            cancelToWorkerTerminatedMs: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.phases.cancelToWorkerTerminatedMs
                )
            ),
            cancelTransportLatencyMs: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.phases.cancelTransportLatencyMs
                )
            ),
            databaseWorkerExternalPeakBytes: workerMetric(
                PERFORMANCE_WORKER_KIND.DATABASE,
                (worker) => worker.peakExternalBytes
            ),
            databaseWorkerHeapPeakBytes: workerMetric(
                PERFORMANCE_WORKER_KIND.DATABASE,
                (worker) => worker.peakHeapUsedBytes
            ),
            databaseWorkerPostGcHeapBytes: workerMetric(
                PERFORMANCE_WORKER_KIND.DATABASE,
                (worker) => worker.postGcHeapUsedBytes
            ),
            databaseWorkerRequestEventLoopDelayMaxMs:
                workerRequestEventLoopDelayMetric(
                    PERFORMANCE_WORKER_KIND.DATABASE,
                    'maxMs'
                ),
            databaseWorkerRequestEventLoopDelayP95Ms:
                workerRequestEventLoopDelayMetric(
                    PERFORMANCE_WORKER_KIND.DATABASE,
                    'p95Ms'
                ),
            databaseWorkerRequestEventLoopDelayP99Ms:
                workerRequestEventLoopDelayMetric(
                    PERFORMANCE_WORKER_KIND.DATABASE,
                    'p99Ms'
                ),
            databaseWorkerRequestEventLoopUtilization: workerRequestMetric(
                PERFORMANCE_WORKER_KIND.DATABASE,
                (request) => request.eventLoopUtilization
            ),
            databaseWorkerRequestThreadCpuSystemMicros: workerRequestMetric(
                PERFORMANCE_WORKER_KIND.DATABASE,
                (request) => request.threadCpuSystemMicros
            ),
            databaseWorkerRequestThreadCpuUserMicros: workerRequestMetric(
                PERFORMANCE_WORKER_KIND.DATABASE,
                (request) => request.threadCpuUserMicros
            ),
            dataFetchMs: summarizeNumbers(
                measured.map((iteration) => iteration.phases.dataFetchMs)
            ),
            dbCommitProxyMs: summarizeNumbers(
                measured.map((iteration) => iteration.phases.dbCommitProxyMs)
            ),
            ipcStoreDispatchProxyMs: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.phases.ipcStoreDispatchProxyMs
                )
            ),
            mainEventLoopDelayMaxMs: summarizeNumbers(
                measured.map((iteration) => iteration.main.eventLoopDelay.maxMs)
            ),
            mainEventLoopDelayP95Ms: summarizeNumbers(
                measured.map((iteration) => iteration.main.eventLoopDelay.p95Ms)
            ),
            mainEventLoopDelayP99Ms: summarizeNumbers(
                measured.map((iteration) => iteration.main.eventLoopDelay.p99Ms)
            ),
            mainEventLoopUtilization: summarizeNumbers(
                measured.map((iteration) => iteration.main.eventLoopUtilization)
            ),
            mainHeapPeakBytes: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.main.memory.peakHeapUsedBytes
                )
            ),
            mainHeapPostGcBytes: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.main.memory.postGcHeapUsedBytes
                )
            ),
            mainRssPeakBytes: summarizeNumbers(
                measured.map((iteration) => iteration.main.memory.peakRssBytes)
            ),
            mainRssPostGcBytes: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.main.memory.postGcRssBytes
                )
            ),
            parseNormalizeCloneProxyMs: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.phases.parseNormalizeCloneProxyMs
                )
            ),
            persistencePreparationProxyMs: summarizeNumbers(
                measured.map(
                    (iteration) =>
                        iteration.phases.persistencePreparationProxyMs
                )
            ),
            playlistWorkerExternalPeakBytes: workerMetric(
                PERFORMANCE_WORKER_KIND.PLAYLIST_REFRESH,
                (worker) => worker.peakExternalBytes
            ),
            playlistWorkerHeapPeakBytes: workerMetric(
                PERFORMANCE_WORKER_KIND.PLAYLIST_REFRESH,
                (worker) => worker.peakHeapUsedBytes
            ),
            playlistWorkerPostGcHeapBytes: workerMetric(
                PERFORMANCE_WORKER_KIND.PLAYLIST_REFRESH,
                (worker) => worker.postGcHeapUsedBytes
            ),
            playlistWorkerRequestEventLoopDelayMaxMs:
                workerRequestEventLoopDelayMetric(
                    PERFORMANCE_WORKER_KIND.PLAYLIST_REFRESH,
                    'maxMs'
                ),
            playlistWorkerRequestEventLoopDelayP95Ms:
                workerRequestEventLoopDelayMetric(
                    PERFORMANCE_WORKER_KIND.PLAYLIST_REFRESH,
                    'p95Ms'
                ),
            playlistWorkerRequestEventLoopDelayP99Ms:
                workerRequestEventLoopDelayMetric(
                    PERFORMANCE_WORKER_KIND.PLAYLIST_REFRESH,
                    'p99Ms'
                ),
            playlistWorkerRequestEventLoopUtilization: workerRequestMetric(
                PERFORMANCE_WORKER_KIND.PLAYLIST_REFRESH,
                (request) => request.eventLoopUtilization
            ),
            playlistWorkerRequestThreadCpuSystemMicros: workerRequestMetric(
                PERFORMANCE_WORKER_KIND.PLAYLIST_REFRESH,
                (request) => request.threadCpuSystemMicros
            ),
            playlistWorkerRequestThreadCpuUserMicros: workerRequestMetric(
                PERFORMANCE_WORKER_KIND.PLAYLIST_REFRESH,
                (request) => request.threadCpuUserMicros
            ),
            rendererFrameGapMs: summarizeNumbers(
                flattenRenderer(
                    (iteration) => iteration.renderer.probe.frameGapsMs
                )
            ),
            rendererHeartbeatDelayMs: summarizeNumbers(
                flattenRenderer(
                    (iteration) => iteration.renderer.probe.heartbeatDelaysMs
                )
            ),
            rendererHeapPeakBytes: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.renderer.peakHeapUsedBytes
                )
            ),
            rendererHeapPostGcBytes: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.renderer.postGcHeapUsedBytes
                )
            ),
            rendererLongTaskCount: measured.reduce(
                (sum, iteration) =>
                    sum + iteration.renderer.probe.longTasksMs.length,
                0
            ),
            rendererLongTaskMs: summarizeNumbers(
                flattenRenderer(
                    (iteration) => iteration.renderer.probe.longTasksMs
                )
            ),
            rendererRssPeakBytes: summarizeNumbers(
                measured.map(
                    (iteration) =>
                        iteration.main.rendererWindow.rss.peakRssBytes
                )
            ),
            responsiveEvents: measured.reduce(
                (sum, iteration) =>
                    sum + iteration.main.rendererWindow.responsiveEvents,
                0
            ),
            totalMs: summarizeNumbers(
                measured.map((iteration) => iteration.phases.totalMs)
            ),
            uiSettlementToPaintMs: summarizeNumbers(
                measured.map(
                    (iteration) => iteration.phases.uiSettlementToPaintMs
                )
            ),
            unresponsiveEvents: measured.reduce(
                (sum, iteration) =>
                    sum + iteration.main.rendererWindow.unresponsiveEvents,
                0
            ),
            visibleTotalMs: summarizeNumbers(
                measured.map((iteration) => iteration.phases.visibleTotalMs)
            ),
        }),
        validity: Object.freeze({
            databaseWorkerPostGc:
                assessDatabaseWorkerPostGcValidity(iterations),
        }),
    });
}

function derivePhases(
    main: MainCaptureMetrics,
    renderer: RendererCaptureMetrics
): CancellationPhaseMetrics {
    const started = findTimeline(
        main.timeline,
        'playlist-event:started:fetching'
    );
    const parsing = findTimeline(
        main.timeline,
        'playlist-event:progress:parsing'
    );
    const response = findTimeline(main.timeline, 'playlist-response');
    const playlistRequest = findTimeline(main.timeline, 'playlist-request');
    const playlistId = playlistRequest?.playlistId;
    const dbGetRequest = findPlaylistDbRecord(
        main.timeline,
        'db-request',
        response?.epochMs,
        'DB_GET_APP_PLAYLIST',
        playlistId
    );
    const dbGetResponse = findResponse(main.timeline, dbGetRequest);
    const dbUpsertRequest = findPlaylistDbRecord(
        main.timeline,
        'db-request',
        dbGetResponse?.epochMs ?? dbGetRequest?.epochMs ?? response?.epochMs,
        'DB_UPSERT_APP_PLAYLIST',
        playlistId
    );
    const dbUpsertResponse = findResponse(main.timeline, dbUpsertRequest);
    const playlistWorker = main.workers.find(
        (worker) => worker.kind === 'playlist-refresh.worker'
    );
    const cancelClick = renderer.probe.cancelClickEpochMs;
    const uiPainted =
        renderer.probe.uiPaintedEpochMs ?? renderer.probe.terminalEpochMs;
    const cancelledEvent = renderer.probe.events.find(
        (event) => event.status === 'cancelled'
    );
    const terminal = maxEpoch(
        uiPainted,
        dbUpsertResponse?.epochMs,
        cancelledEvent?.receivedEpochMs,
        response?.epochMs,
        playlistWorker?.terminatedEpochMs
    );

    return Object.freeze({
        cancelAcknowledgementLatencyMs: nonNegativeDifference(
            cancelledEvent?.receivedEpochMs,
            cancelClick
        ),
        cancelToDurableTerminalMs: nonNegativeDifference(terminal, cancelClick),
        cancelToWorkerTerminatedMs: nonNegativeDifference(
            playlistWorker?.terminatedEpochMs,
            cancelClick
        ),
        cancelTransportLatencyMs: nonNegativeDifference(
            playlistWorker?.cancelPostedEpochMs,
            cancelClick
        ),
        dataFetchMs: nonNegativeDifference(parsing?.epochMs, started?.epochMs),
        dbCommitProxyMs: nonNegativeDifference(
            dbUpsertResponse?.epochMs,
            dbUpsertRequest?.epochMs
        ),
        ipcStoreDispatchProxyMs: nonNegativeDifference(
            dbGetRequest?.epochMs,
            response?.epochMs
        ),
        parseNormalizeCloneProxyMs: nonNegativeDifference(
            response?.epochMs,
            parsing?.epochMs
        ),
        persistencePreparationProxyMs: nonNegativeDifference(
            dbUpsertRequest?.epochMs,
            dbGetResponse?.epochMs
        ),
        totalMs: nonNegativeDifference(
            terminal,
            renderer.probe.operationStartEpochMs
        ),
        uiSettlementToPaintMs: nonNegativeDifference(
            uiPainted,
            renderer.probe.uiSettledEpochMs
        ),
        visibleTotalMs: nonNegativeDifference(
            uiPainted,
            renderer.probe.operationStartEpochMs
        ),
    });
}

function findTimeline(
    timeline: readonly MainTimelineRecord[],
    type: string
): MainTimelineRecord | undefined {
    return timeline.find((record) => record.type === type);
}

function findPlaylistDbRecord(
    timeline: readonly MainTimelineRecord[],
    type: string,
    afterEpochMs: number | undefined,
    operation: string,
    playlistId: string | undefined
): MainTimelineRecord | undefined {
    if (afterEpochMs === undefined) {
        return undefined;
    }
    return timeline.find(
        (record) =>
            record.type === type &&
            record.epochMs >= afterEpochMs &&
            record.operation === operation &&
            (playlistId === undefined || record.playlistId === playlistId)
    );
}

function findResponse(
    timeline: readonly MainTimelineRecord[],
    request: MainTimelineRecord | undefined
): MainTimelineRecord | undefined {
    if (request?.requestId === undefined) {
        return undefined;
    }
    return timeline.find(
        (record) =>
            record.type === 'db-response' &&
            record.requestId === request.requestId
    );
}

function maxEpoch(
    ...values: readonly (number | null | undefined)[]
): number | null {
    const finite = values.filter(
        (value): value is number =>
            typeof value === 'number' && Number.isFinite(value)
    );
    return finite.length === 0 ? null : Math.max(...finite);
}
