import type {
    RendererProcessRssCapture,
    RendererProcessRssUnavailableReason,
} from './renderer-process-rss-capture';

export const PERFORMANCE_ITERATION_KIND = {
    DIAGNOSTIC: 'diagnostic',
    MEASURED: 'measured',
    WARMUP: 'warmup',
} as const;

export type PerformanceIterationKind =
    (typeof PERFORMANCE_ITERATION_KIND)[keyof typeof PERFORMANCE_ITERATION_KIND];

export const PERFORMANCE_WORKER_KIND = {
    DATABASE: 'database.worker',
    PLAYLIST_REFRESH: 'playlist-refresh.worker',
} as const;

export type PerformanceWorkerKind =
    (typeof PERFORMANCE_WORKER_KIND)[keyof typeof PERFORMANCE_WORKER_KIND];

export const WORKER_POST_GC_HEAP_UNAVAILABLE_REASON = {
    CAPTURE_FAILED: 'capture-failed',
    DATABASE_WORKER_ACTIVITY_AFTER_CUTOFF:
        'database-worker-activity-after-cutoff',
    DATABASE_WORKER_MISSING: 'database-worker-missing',
    DATABASE_WORKER_NOT_IDLE: 'database-worker-not-idle',
    DATABASE_WORKER_UNEXPECTED_ACTIVITY: 'database-worker-unexpected-activity',
    GC_UNAVAILABLE: 'gc-unavailable',
    INVALID_CAPTURE: 'post-gc-capture-invalid',
    MULTIPLE_DATABASE_WORKERS: 'multiple-database-workers',
    PROBE_INVALID_RESPONSE: 'post-gc-probe-invalid-response',
    PROBE_MESSAGE_ERROR: 'post-gc-probe-message-error',
    PROBE_NOT_RUN: 'post-gc-probe-not-run',
    PROBE_PORT_CLOSED: 'post-gc-probe-port-closed',
    PROBE_POST_FAILED: 'post-gc-probe-post-failed',
    PROBE_TIMEOUT: 'post-gc-probe-timeout',
    PROFILING_DISABLED: 'profiling-disabled',
    WORKER_BUSY: 'worker-busy',
    WORKER_FORCE_TERMINATED: 'worker-force-terminated-before-gc',
} as const;

export type WorkerPostGcHeapUnavailableReason =
    (typeof WORKER_POST_GC_HEAP_UNAVAILABLE_REASON)[keyof typeof WORKER_POST_GC_HEAP_UNAVAILABLE_REASON];

export type WorkerPostGcHeapCapture =
    | {
          readonly postGcHeapUnavailableReason: null;
          readonly postGcHeapUsedBytes: number;
      }
    | {
          readonly postGcHeapUnavailableReason: WorkerPostGcHeapUnavailableReason;
          readonly postGcHeapUsedBytes: null;
      };

export interface NumericDistribution {
    readonly count: number;
    readonly max: number | null;
    readonly mean: number | null;
    readonly median: number | null;
    readonly min: number | null;
    readonly p95: number | null;
    readonly p99: number | null;
}

export interface EventLoopDelayMetrics {
    readonly maxMs: number;
    readonly p95Ms: number;
    readonly p99Ms: number;
}

export interface ProcessMemoryMetrics {
    readonly peakHeapUsedBytes: number;
    readonly peakRssBytes: number;
    readonly postGcHeapUsedBytes: number | null;
    readonly postGcRssBytes: number | null;
}

export interface MainTimelineRecord {
    readonly epochMs: number;
    readonly operation?: string;
    readonly operationId?: string;
    readonly playlistId?: string;
    readonly requestId?: string;
    readonly success?: boolean;
    readonly type: string;
}

export interface WorkerRequestPerformanceMetrics {
    readonly eventLoopDelay: EventLoopDelayMetrics | null;
    readonly eventLoopDelayUnavailableReason: string | null;
    readonly eventLoopUtilization: number | null;
    readonly eventLoopUtilizationUnavailableReason: string | null;
    readonly histogramFlushedEpochMs: number | null;
    readonly invalidReason: string | null;
    readonly operation: string | null;
    readonly operationId: string | null;
    readonly operationIdUnavailableReason: string | null;
    readonly performanceCaptureUnavailableReason: string | null;
    readonly playlistId: string | null;
    readonly requestId: string | null;
    readonly requestReceivedEpochMs: number | null;
    readonly responseEpochMs: number;
    readonly success: boolean;
    readonly threadCpuSystemMicros: number | null;
    readonly threadCpuUnavailableReason: string | null;
    readonly threadCpuUserMicros: number | null;
    readonly workEndedEpochMs: number | null;
    readonly workStartedEpochMs: number | null;
}

export type WorkerCaptureMetrics = {
    readonly cancelPostedEpochMs: number | null;
    readonly cpuSystemMicros: number | null;
    readonly cpuUserMicros: number | null;
    readonly eventLoopDelay: EventLoopDelayMetrics | null;
    readonly eventLoopDelayUnavailableReason: string | null;
    readonly eventLoopUtilization: number | null;
    readonly kind: PerformanceWorkerKind;
    readonly operationId: string | null;
    readonly ordinal: number;
    readonly peakExternalBytes: number;
    readonly peakHeapUsedBytes: number;
    readonly playlistId: string | null;
    readonly profilePath: string | null;
    readonly requests: readonly WorkerRequestPerformanceMetrics[];
    readonly responseEpochMs: number | null;
    readonly snapshotPath: string | null;
    readonly terminatedEpochMs: number | null;
} & WorkerPostGcHeapCapture;

export interface MainCaptureMetrics {
    readonly cpuProfilePath: string | null;
    readonly cpuSystemMicros: number;
    readonly cpuUserMicros: number;
    readonly eventLoopDelay: EventLoopDelayMetrics;
    readonly eventLoopUtilization: number | null;
    readonly eventLoopUtilizationUnavailableReason: string | null;
    readonly heapSnapshotPath: string | null;
    readonly memory: ProcessMemoryMetrics;
    readonly rendererWindow: {
        readonly responsiveEvents: number;
        readonly rss: RendererProcessRssCapture;
        readonly unresponsiveEvents: number;
        readonly windowIdentity: {
            readonly browserWindowId: number;
            readonly webContentsId: number;
        };
    };
    readonly rssScope: 'electron-main-process-including-worker-threads-and-native-memory';
    readonly timeline: readonly MainTimelineRecord[];
    readonly workers: readonly WorkerCaptureMetrics[];
}

export interface PlaylistRefreshProbeEvent {
    readonly operationId: string;
    readonly phase: string | null;
    readonly receivedEpochMs: number;
    readonly status: string;
}

export interface RendererProbeMetrics {
    readonly cancelButtonFound: boolean;
    readonly cancelClickEpochMs: number | null;
    readonly events: readonly PlaylistRefreshProbeEvent[];
    readonly frameGapsMs: readonly number[];
    readonly heartbeatDelaysMs: readonly number[];
    readonly longTasksMs: readonly number[];
    readonly operationStartEpochMs: number;
    readonly terminalEpochMs: number | null;
    readonly uiPaintedEpochMs: number | null;
    readonly uiPhaseEpochMs: Readonly<Record<string, number>>;
    readonly uiSettledEpochMs: number | null;
}

export interface RendererCaptureMetrics {
    readonly cpuProfilePath: string | null;
    readonly frameGap: NumericDistribution;
    readonly heapSnapshotPath: string | null;
    readonly heartbeatDelay: NumericDistribution;
    readonly longTask: NumericDistribution;
    readonly peakHeapUsedBytes: number;
    readonly postGcHeapUsedBytes: number | null;
    readonly probe: RendererProbeMetrics;
    readonly tracePath: string | null;
}

export interface CancellationPhaseMetrics {
    readonly cancelAcknowledgementLatencyMs: number | null;
    readonly cancelToDurableTerminalMs: number | null;
    readonly cancelToWorkerTerminatedMs: number | null;
    readonly cancelTransportLatencyMs: number | null;
    readonly dataFetchMs: number | null;
    readonly dbCommitProxyMs: number | null;
    readonly ipcStoreDispatchProxyMs: number | null;
    readonly parseNormalizeCloneProxyMs: number | null;
    readonly persistencePreparationProxyMs: number | null;
    readonly totalMs: number | null;
    readonly uiSettlementToPaintMs: number | null;
    readonly visibleTotalMs: number | null;
}

export interface CancellationIterationResult {
    readonly cancellationEffectObserved: boolean;
    readonly kind: PerformanceIterationKind;
    readonly main: MainCaptureMetrics;
    readonly phases: CancellationPhaseMetrics;
    readonly renderer: RendererCaptureMetrics;
    readonly runId: string;
}

export interface CancellationBenchmarkManifest {
    readonly channelCount: number;
    readonly fixtureBytes: number;
    readonly fixtureSha256: string;
    readonly gitCommit: string;
    readonly gitDiffSha256: string;
    readonly gitDirty: boolean;
    readonly measuredRuns: number;
    readonly memoryAccounting: {
        readonly mainRss: 'electron-main-process-including-worker-threads-and-native-memory';
        readonly rendererRss: 'separate-renderer-process';
        readonly workerJsHeap: 'separate-v8-isolate';
        readonly workerRss: 'unavailable-per-thread';
    };
    readonly scenario: 'm3u-refresh-cancel';
    readonly syntheticSeed: number;
    readonly runtime: {
        readonly arch: string;
        readonly electronVersion: string;
        readonly harnessNodeVersion: string;
        readonly platform: string;
    };
    readonly variant: string;
    readonly warmupRuns: number;
}

export interface InvalidDatabaseWorkerPostGcMeasuredRun {
    readonly databaseWorkerCount: number;
    readonly reason: string;
    readonly runId: string;
}

export interface NotApplicableDatabaseWorkerPostGcMeasuredRun {
    readonly reason: 'operation-cancelled-before-database-phase';
    readonly runId: string;
}

export interface DatabaseWorkerPostGcValidity {
    readonly applicableMeasuredRunCount: number;
    readonly invalidMeasuredRuns: readonly InvalidDatabaseWorkerPostGcMeasuredRun[];
    readonly measuredRunCount: number;
    readonly notApplicableMeasuredRuns: readonly NotApplicableDatabaseWorkerPostGcMeasuredRun[];
    readonly validForBenchmark: boolean;
    readonly validForComparison: boolean;
    readonly validMeasuredRunCount: number;
}

export interface InvalidRendererRssMeasuredRun {
    readonly missingSampleCount: number;
    readonly reason:
        RendererProcessRssUnavailableReason | 'renderer-rss-capture-invalid';
    readonly runId: string;
    readonly validSampleCount: number;
}

export interface RendererRssValidity {
    readonly invalidMeasuredRuns: readonly InvalidRendererRssMeasuredRun[];
    readonly measuredRunCount: number;
    readonly validForBenchmark: boolean;
    readonly validForComparison: boolean;
    readonly validMeasuredRunCount: number;
}

export interface CancellationBenchmarkSummary {
    readonly cancellationEffectRate: number;
    readonly iterations: readonly CancellationIterationResult[];
    readonly manifest: CancellationBenchmarkManifest;
    readonly measured: {
        readonly cancelAcknowledgementLatencyMs: NumericDistribution;
        readonly cancelToDurableTerminalMs: NumericDistribution;
        readonly cancelToWorkerTerminatedMs: NumericDistribution;
        readonly cancelTransportLatencyMs: NumericDistribution;
        readonly databaseWorkerExternalPeakBytes: NumericDistribution;
        readonly databaseWorkerHeapPeakBytes: NumericDistribution;
        readonly databaseWorkerPostGcHeapBytes: NumericDistribution;
        readonly databaseWorkerRequestEventLoopDelayMaxMs: NumericDistribution;
        readonly databaseWorkerRequestEventLoopDelayP95Ms: NumericDistribution;
        readonly databaseWorkerRequestEventLoopDelayP99Ms: NumericDistribution;
        readonly databaseWorkerRequestEventLoopUtilization: NumericDistribution;
        readonly databaseWorkerRequestThreadCpuSystemMicros: NumericDistribution;
        readonly databaseWorkerRequestThreadCpuUserMicros: NumericDistribution;
        readonly dataFetchMs: NumericDistribution;
        readonly dbCommitProxyMs: NumericDistribution;
        readonly ipcStoreDispatchProxyMs: NumericDistribution;
        readonly mainEventLoopDelayMaxMs: NumericDistribution;
        readonly mainEventLoopDelayP95Ms: NumericDistribution;
        readonly mainEventLoopDelayP99Ms: NumericDistribution;
        readonly mainEventLoopUtilization: NumericDistribution;
        readonly mainHeapPeakBytes: NumericDistribution;
        readonly mainHeapPostGcBytes: NumericDistribution;
        readonly mainRssPeakBytes: NumericDistribution;
        readonly mainRssPostGcBytes: NumericDistribution;
        readonly parseNormalizeCloneProxyMs: NumericDistribution;
        readonly persistencePreparationProxyMs: NumericDistribution;
        readonly playlistWorkerExternalPeakBytes: NumericDistribution;
        readonly playlistWorkerHeapPeakBytes: NumericDistribution;
        readonly playlistWorkerPostGcHeapBytes: NumericDistribution;
        readonly playlistWorkerRequestEventLoopDelayMaxMs: NumericDistribution;
        readonly playlistWorkerRequestEventLoopDelayP95Ms: NumericDistribution;
        readonly playlistWorkerRequestEventLoopDelayP99Ms: NumericDistribution;
        readonly playlistWorkerRequestEventLoopUtilization: NumericDistribution;
        readonly playlistWorkerRequestThreadCpuSystemMicros: NumericDistribution;
        readonly playlistWorkerRequestThreadCpuUserMicros: NumericDistribution;
        readonly rendererFrameGapMs: NumericDistribution;
        readonly rendererHeartbeatDelayMs: NumericDistribution;
        readonly rendererHeapPeakBytes: NumericDistribution;
        readonly rendererHeapPostGcBytes: NumericDistribution;
        readonly rendererLongTaskCount: number;
        readonly rendererLongTaskMs: NumericDistribution;
        readonly rendererRssPeakBytes: NumericDistribution;
        readonly responsiveEvents: number;
        readonly totalMs: NumericDistribution;
        readonly uiSettlementToPaintMs: NumericDistribution;
        readonly unresponsiveEvents: number;
        readonly visibleTotalMs: NumericDistribution;
    };
    readonly validity: {
        readonly databaseWorkerPostGc: DatabaseWorkerPostGcValidity;
        readonly rendererRss: RendererRssValidity;
    };
}
