import type {
    NumericDistribution,
    XtreamBenchmarkManifest,
    XtreamIterationDefinition,
    XtreamScenarioMetrics,
    XtreamScenarioId,
} from './xtream-benchmark-contract';
import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import type { DatabaseWorkerCancelTimelineRecord } from './database-worker-cancel-capture';
import type {
    XtreamPhaseAttribution,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';

export type {
    NumericDistribution,
    XtreamBenchmarkManifest,
    XtreamScenarioMetrics,
};

export const XTREAM_MEMORY_ACCOUNTING = Object.freeze({
    mainRss: 'electron-main-process-including-worker-threads-and-native-memory',
    rendererRss: 'separate-renderer-process',
    workerJsHeap: 'separate-v8-isolate',
    workerRss: 'unavailable-per-worker-thread',
});

export const XTREAM_NOT_APPLICABLE = {
    COMMIT_INCLUDED_IN_SQLITE_WRITE:
        'included-in-sqlite-write-transaction-spans',
    DATABASE_WORKER_RSS: 'unavailable-per-worker-thread',
    DEBUG_COPY: 'production-debug-send-disabled',
    INDEXES_PRE_EXIST: 'schema-indexes-pre-exist; operation-creates-none',
    MAIN_EVENT_LOOP_UTILIZATION: 'electron-main-embedded-event-loop',
    NATIVE_SQLITE_MEMORY: 'included-in-main-rss-not-separately-attributable',
    PLAYLIST_REFRESH_WORKER: 'not-instantiated-by-xtream-flow',
    PROFILE_OUTSIDE_DIAGNOSTIC: 'not-captured-outside-diagnostic',
    RESTORE_NOT_INVOKED: 'not-invoked-by-scenario',
    RESTORE_NO_USER_DATA: 'no-user-data',
    SOURCES_SEARCH_MARKER:
        'sources-search-does-not-publish-xtream-search-results',
} as const;

export const XTREAM_RENDERER_VISIBILITY = {
    VISIBLE_WITHOUT_OVERLAY: 'visible-without-overlay',
} as const;

export const XTREAM_CANCEL_NETWORK_ABORT_REASON = {
    AFTER_NETWORK_COMPLETE: 'cancel-triggered-after-network-complete',
} as const;

export const XTREAM_WORKER_REQUEST_INVALID_REASON = {
    OVERLAPPING_DATABASE_REQUESTS: 'overlapping-database-worker-requests',
} as const;

export const XTREAM_WORKER_REQUEST_METRIC_SCOPE = {
    VALID_REQUEST_WINDOW_PROXY: 'valid-request-window-proxy',
} as const;

export const XTREAM_MAIN_CPU_METRIC_SCOPE = {
    ELECTRON_MAIN_THREAD: 'electron-main-thread',
} as const;

export const XTREAM_WORKER_CPU_METRIC_SCOPE = {
    SUM_VALID_REQUEST_WORK: 'sum-valid-request-thread-cpu',
} as const;

export const XTREAM_WORKER_WHOLE_METRIC_SCOPE = {
    OPERATION_WINDOW: 'whole-worker-operation-window',
} as const;

export const XTREAM_STARTUP_RETRY_REASON = {
    SQLITE_DATABASE_LOCKED: 'sqlite-database-locked',
    SQLITE_SCHEMA_NOT_READY: 'sqlite-schema-not-ready',
} as const;

export type XtreamStartupRetryReason =
    (typeof XTREAM_STARTUP_RETRY_REASON)[keyof typeof XTREAM_STARTUP_RETRY_REASON];

export const XTREAM_STRUCTURED_CLONE_ATTRIBUTION = {
    SELECTED_IPC_PROXY: 'selected-ipc-proxy-includes-queueing-and-scheduling',
} as const;

type ProfileUnavailableReason =
    typeof XTREAM_NOT_APPLICABLE.PROFILE_OUTSIDE_DIAGNOSTIC | null;

export interface XtreamProfileCapture {
    readonly cpuProfileDurationMicros: number | null;
    readonly cpuProfileUnavailableReason: ProfileUnavailableReason;
}

export interface XtreamRendererMetrics extends XtreamProfileCapture {
    readonly actionLatencyMs: number | null;
    readonly consoleErrors: readonly string[];
    readonly dashboardPaintVisibility:
        typeof XTREAM_RENDERER_VISIBILITY.VISIBLE_WITHOUT_OVERLAY | null;
    readonly frameGapMaxMs: number;
    readonly frameGapP95Ms: number;
    readonly heartbeatMaxMs: number;
    readonly heartbeatP95Ms: number;
    readonly longTaskCount: number;
    readonly longTaskMaxMs: number;
    readonly navigationLatencyMs: number | null;
    readonly peakHeapUsedBytes: number;
    readonly peakRssBytes: number;
    readonly postGcHeapUsedBytes: number;
    readonly searchLatencyMs: number | null;
    readonly storeToPaintMs: number;
    readonly targetId: string;
}

export interface XtreamMainMetrics extends XtreamProfileCapture {
    readonly browserWindowId: number;
    readonly cpuMetricScope: typeof XTREAM_MAIN_CPU_METRIC_SCOPE.ELECTRON_MAIN_THREAD;
    readonly cpuSystemMicros: number;
    readonly cpuUserMicros: number;
    readonly eventLoopDelayMaxMs: number;
    readonly eventLoopDelayP95Ms: number;
    readonly eventLoopDelayP99Ms: number;
    readonly eventLoopUtilization: null;
    readonly eventLoopUtilizationUnavailableReason: typeof XTREAM_NOT_APPLICABLE.MAIN_EVENT_LOOP_UTILIZATION;
    readonly peakHeapUsedBytes: number;
    readonly peakRssBytes: number;
    readonly postGcHeapUsedBytes: number;
    readonly responsiveEvents: number;
    readonly unresponsiveEvents: number;
    readonly webContentsId: number;
}

export interface XtreamDatabaseWorkerMetrics extends XtreamProfileCapture {
    readonly cpuMetricScope: typeof XTREAM_WORKER_CPU_METRIC_SCOPE.SUM_VALID_REQUEST_WORK;
    readonly cpuSystemMicros: number;
    readonly cpuUserMicros: number;
    readonly currentForCapture: boolean;
    readonly eventLoopDelayMaxMs: number;
    readonly eventLoopDelayMetricScope: typeof XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY;
    readonly eventLoopDelayP95Ms: number;
    readonly eventLoopDelayP99Ms: number;
    readonly eventLoopUtilization: number;
    readonly kind: 'database.worker';
    readonly ordinal: number;
    readonly peakExternalBytes: number;
    readonly peakHeapUsedBytes: number;
    readonly postGcHeapUsedBytes: number;
    readonly requests: XtreamWorkerRequestAccounting;
    readonly rssBytes: null;
    readonly rssUnavailableReason: 'unavailable-per-worker-thread';
    readonly wholeWorkerMetricScope: typeof XTREAM_WORKER_WHOLE_METRIC_SCOPE.OPERATION_WINDOW;
}

export interface XtreamWorkerRequestAccounting {
    readonly evidence: readonly WorkerRequestPerformanceMetrics[];
    readonly eventLoopDelayMaxMs: number;
    readonly eventLoopDelayP95Ms: number;
    readonly eventLoopDelayP99Ms: number;
    readonly eventLoopUtilization: number;
    readonly invalidReasons: readonly XtreamWorkerRequestInvalidReasonCount[];
    readonly invalidSampleCount: number;
    readonly metricScope: typeof XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY;
    readonly totalCount: number;
    readonly validSampleCount: number;
}

export interface XtreamWorkerRequestInvalidReasonCount {
    readonly count: number;
    readonly reason: typeof XTREAM_WORKER_REQUEST_INVALID_REASON.OVERLAPPING_DATABASE_REQUESTS;
}

export interface XtreamPlaylistRefreshWorkerState {
    readonly instantiated: false;
    readonly reason: 'not-instantiated-by-xtream-flow';
}

export interface XtreamCancellationMetrics {
    readonly acknowledgementLatencyMs: number | null;
    readonly authoritativeDatabaseAcknowledgementObserved: boolean;
    readonly authoritativeTerminalEpochMs: number | null;
    readonly clickEpochMs: number | null;
    readonly clickToDatabaseDispatchMs: number | null;
    readonly clickToPaintMs: number | null;
    readonly clickToPreloadReturnMs: number | null;
    readonly databaseDispatchEpochMs: number | null;
    readonly failedDatabaseRequestId: string | null;
    readonly failedOperationId: string | null;
    readonly mainNetworkAbortObserved: boolean;
    readonly mainNetworkAbortReason:
        typeof XTREAM_CANCEL_NETWORK_ABORT_REASON.AFTER_NETWORK_COMPLETE | null;
    readonly paintedEpochMs: number | null;
    readonly preloadReturnEpochMs: number | null;
    readonly preloadStartEpochMs: number | null;
    readonly workerReceiptEpochMs: number | null;
    readonly workerReceiptIsAuthoritative: false;
    readonly workerReceiptLatencyMs: number | null;
}

export interface XtreamCancellationEvidence {
    readonly timeline: readonly DatabaseWorkerCancelTimelineRecord[];
}

export interface XtreamCatalogVerification {
    readonly databaseStateValid: boolean;
    readonly fixtureIdentityValid: boolean;
    readonly providerCategoryCount: 100;
    readonly providerItemCount: 100_000;
    readonly verifiedAfterCapture: boolean;
}

export interface XtreamIterationValidity {
    readonly actionContractValid: boolean;
    readonly catalogContractValid: boolean;
    readonly databaseWorkerCount: number;
    readonly dbPhaseContractValid: boolean;
    readonly diagnosticArtifactsValid: boolean | null;
    readonly lateDatabaseRequestCount: number;
    readonly playlistWorkerCount: number;
    readonly rendererTargetCount: number;
}

export interface XtreamIterationProcessIdentity {
    readonly captureGeneration: number;
    readonly electronPid: number;
    readonly freshProcess: true;
    readonly generationIdentitySha256: string;
    readonly launchId: string;
    readonly profileDirectorySha256: string;
    readonly startupAttemptCount: 1 | 2;
    readonly startupRetryReasons: readonly XtreamStartupRetryReason[];
}

export interface XtreamRawIterationResult extends XtreamIterationDefinition {
    readonly cancellation: XtreamCancellationMetrics;
    readonly cancellationEvidence: XtreamCancellationEvidence | null;
    readonly catalogVerification: XtreamCatalogVerification;
    readonly databaseWorker: XtreamDatabaseWorkerMetrics;
    readonly main: XtreamMainMetrics;
    readonly phaseCapture: XtreamPhaseAttributionInput;
    readonly phases: XtreamPhaseAttribution;
    readonly playlistRefreshWorker: XtreamPlaylistRefreshWorkerState;
    readonly processIdentity: XtreamIterationProcessIdentity;
    readonly renderer: XtreamRendererMetrics;
    readonly validity: XtreamIterationValidity;
}

export interface XtreamArtifactSafetyContext {
    readonly controlToken: string;
    readonly syntheticCredentials: {
        readonly password: 'performance';
        readonly username: 'performance';
    };
}

export interface XtreamPersistenceReceipt {
    readonly absolutePath: string;
    readonly bytes: number;
    readonly sha256: string;
}

export interface XtreamPersistedRawEvidence {
    readonly bytes: number;
    readonly pathSha256: string;
    readonly rawSha256: string;
}

export interface XtreamValidatedIterationResult extends XtreamRawIterationResult {
    readonly persistence: XtreamPersistedRawEvidence;
    readonly validationStatus: 'valid';
}

export interface XtreamNotApplicableMetric {
    readonly reason: string;
    readonly value: null;
}

export interface XtreamDiagnosticProfiles {
    readonly artifactProvenance: XtreamDiagnosticArtifactProvenance;
    readonly databaseWorkerDurationMicros: number | null;
    readonly mainDurationMicros: number | null;
    readonly rendererDurationMicros: number | null;
}

export interface XtreamDiagnosticArtifactProvenance {
    readonly artifacts: readonly XtreamDiagnosticArtifactReceipt[];
    readonly directorySha256: string;
}

export interface XtreamDiagnosticArtifactReceipt {
    readonly bytes: number;
    readonly filename: string;
    readonly label: string;
    readonly sha256: string;
}

export interface XtreamScenarioSummary {
    readonly databaseWorkerEventLoopDelayMetricScope: typeof XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY;
    readonly databaseWorkerRequestInvalidReasons: readonly (typeof XTREAM_WORKER_REQUEST_INVALID_REASON)[keyof typeof XTREAM_WORKER_REQUEST_INVALID_REASON][];
    readonly databaseWorkerRequestMetricScope: typeof XTREAM_WORKER_REQUEST_METRIC_SCOPE.VALID_REQUEST_WINDOW_PROXY;
    readonly databaseWorkerWholeWorkerMetricScope: typeof XTREAM_WORKER_WHOLE_METRIC_SCOPE.OPERATION_WINDOW;
    readonly dashboardPaintVisibility:
        typeof XTREAM_RENDERER_VISIBILITY.VISIBLE_WITHOUT_OVERLAY | null;
    readonly diagnosticProfiles: XtreamDiagnosticProfiles;
    readonly measuredRuns: number;
    readonly memory: {
        readonly databaseWorkerRss: XtreamNotApplicableMetric;
        readonly nativeAndSqlite: XtreamNotApplicableMetric;
        readonly playlistRefreshWorker: XtreamNotApplicableMetric;
    };
    readonly mainEventLoopUtilization: XtreamNotApplicableMetric;
    readonly metrics: XtreamScenarioMetrics;
    readonly phases: {
        readonly backgroundSearchMarker: XtreamNotApplicableMetric | null;
        readonly debugCopy: XtreamNotApplicableMetric;
        readonly indexes: XtreamNotApplicableMetric;
        readonly restoreUserData: XtreamNotApplicableMetric;
        readonly structuredCloneAttribution: typeof XTREAM_STRUCTURED_CLONE_ATTRIBUTION.SELECTED_IPC_PROXY;
        readonly transactionCommit: XtreamNotApplicableMetric;
    };
    readonly rendererLongTaskCountTotal: number;
    readonly responsiveEventsTotal: number;
    readonly scenarioId: XtreamScenarioId;
    readonly unresponsiveEventsTotal: number;
}

export interface XtreamBenchmarkSummary {
    readonly iterations: readonly XtreamValidatedIterationResult[];
    readonly manifest: XtreamBenchmarkManifest;
    readonly scenarios: readonly XtreamScenarioSummary[];
    readonly validForComparison: boolean;
}
