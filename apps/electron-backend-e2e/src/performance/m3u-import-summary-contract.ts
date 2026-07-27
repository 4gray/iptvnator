import type { DatabaseWorkerPeakMemoryValidity } from './database-worker-peak-memory-validity';
import type { DatabaseWorkerRequestMetricsValidity } from './database-worker-request-metrics-validity';
import type { M3uImportScenarioId } from './m3u-import-benchmark-contract';
import type { M3uImportRendererCaptureMetrics } from './m3u-import-renderer-capture';
import {
    M3U_IMPORT_INDEX_COMMIT_UNAVAILABLE_REASON,
    type M3uImportPhaseMetrics,
} from './m3u-import-report';
import type {
    DatabaseWorkerPostGcValidity,
    MainCaptureMetrics,
    NumericDistribution,
    PerformanceIterationKind,
} from './m3u-refresh-cancellation-contract';
import type { RendererRssValidity } from './renderer-rss-validity';

export interface M3uImportIterationResult {
    readonly channelCount: number;
    readonly fixtureBytes: number;
    readonly kind: PerformanceIterationKind;
    readonly main: MainCaptureMetrics;
    readonly phases: M3uImportPhaseMetrics;
    readonly renderer: M3uImportRendererCaptureMetrics;
    readonly runId: string;
    readonly scenarioId: M3uImportScenarioId;
}

export interface M3uImportBenchmarkManifest {
    readonly channelCount: number;
    readonly fixtureBytes: number;
    readonly fixtureSha256: string;
    readonly gitCommit: string;
    readonly gitDiffSha256: string;
    readonly gitDirty: boolean;
    readonly measuredRuns: number;
    readonly memoryAccounting: {
        readonly databaseWorkerRss: 'unavailable-per-worker-thread';
        readonly mainRss: 'electron-main-process-including-worker-threads-and-native-memory';
        readonly nativeAndSqliteMemory: 'included-in-main-rss-not-separately-attributable';
        readonly rendererRss: 'separate-renderer-process';
        readonly workerJsHeap: 'separate-v8-isolate';
    };
    readonly runtime: {
        readonly arch: string;
        readonly cdpPort: number;
        readonly electronVersion: string;
        readonly harnessNodeVersion: string;
        readonly platform: string;
    };
    readonly scenario: M3uImportScenarioId;
    readonly syntheticSeed: number;
    readonly variant: string;
    readonly warmupRuns: number;
}

export interface M3uImportMeasuredSummary {
    readonly angularRenderingMs: NumericDistribution;
    readonly dataAcquireMs: NumericDistribution;
    readonly databaseWorkerGetEventLoopDelayMaxMs: NumericDistribution;
    readonly databaseWorkerGetEventLoopDelayP95Ms: NumericDistribution;
    readonly databaseWorkerGetEventLoopDelayP99Ms: NumericDistribution;
    readonly databaseWorkerGetEventLoopUtilization: NumericDistribution;
    readonly databaseWorkerGetThreadCpuSystemMicros: NumericDistribution;
    readonly databaseWorkerGetThreadCpuUserMicros: NumericDistribution;
    readonly databaseWorkerEventLoopDelayMaxMs: NumericDistribution;
    readonly databaseWorkerEventLoopDelayP95Ms: NumericDistribution;
    readonly databaseWorkerEventLoopDelayP99Ms: NumericDistribution;
    readonly databaseWorkerEventLoopUtilization: NumericDistribution;
    readonly databaseWorkerExternalPeakBytes: NumericDistribution;
    readonly databaseWorkerHeapPeakBytes: NumericDistribution;
    readonly databaseWorkerPostGcHeapBytes: NumericDistribution;
    readonly databaseWorkerThreadCpuSystemMicros: NumericDistribution;
    readonly databaseWorkerThreadCpuUserMicros: NumericDistribution;
    readonly databaseWorkerToMainCloneProxyMs: NumericDistribution;
    readonly databaseWorkerUpsertEventLoopDelayMaxMs: NumericDistribution;
    readonly databaseWorkerUpsertEventLoopDelayP95Ms: NumericDistribution;
    readonly databaseWorkerUpsertEventLoopDelayP99Ms: NumericDistribution;
    readonly databaseWorkerUpsertEventLoopUtilization: NumericDistribution;
    readonly databaseWorkerUpsertThreadCpuSystemMicros: NumericDistribution;
    readonly databaseWorkerUpsertThreadCpuUserMicros: NumericDistribution;
    readonly ipcStructuredCloneProxyMs: NumericDistribution;
    readonly mainToDatabaseWorkerCloneProxyMs: NumericDistribution;
    readonly mainToRendererCloneProxyMs: NumericDistribution;
    readonly m3uParsingMs: NumericDistribution;
    readonly mainEventLoopDelayMaxMs: NumericDistribution;
    readonly mainEventLoopDelayP95Ms: NumericDistribution;
    readonly mainEventLoopDelayP99Ms: NumericDistribution;
    readonly mainEventLoopUtilization: NumericDistribution;
    readonly mainHeapPeakBytes: NumericDistribution;
    readonly mainHeapPostGcBytes: NumericDistribution;
    readonly mainRssPeakBytes: NumericDistribution;
    readonly mainRssPostGcBytes: NumericDistribution;
    readonly normalizationMs: NumericDistribution;
    readonly playlistDeserializationMs: NumericDistribution;
    readonly playlistSerializationMs: NumericDistribution;
    readonly rendererFrameGapMs: NumericDistribution;
    readonly rendererHeartbeatDelayMs: NumericDistribution;
    readonly rendererHeapPeakBytes: NumericDistribution;
    readonly rendererHeapPostGcBytes: NumericDistribution;
    readonly rendererLongTaskCount: number;
    readonly rendererLongTaskMs: NumericDistribution;
    readonly rendererRssPeakBytes: NumericDistribution;
    readonly rendererToMainCloneProxyMs: NumericDistribution;
    readonly responsiveEvents: number;
    readonly sqliteReadMs: NumericDistribution;
    readonly sqliteWriteMs: NumericDistribution;
    readonly storeImportDispatchMs: NumericDistribution;
    readonly storePublishChannelsMs: NumericDistribution;
    readonly storeUpdateMs: NumericDistribution;
    readonly totalMs: NumericDistribution;
    readonly unresponsiveEvents: number;
}

export interface M3uImportBenchmarkSummary {
    readonly iterations: readonly M3uImportIterationResult[];
    readonly manifest: M3uImportBenchmarkManifest;
    readonly measured: M3uImportMeasuredSummary;
    readonly notApplicable: {
        readonly cancelAcknowledgementLatencyMs: 'scenario-has-no-cancellation';
        readonly databaseWorkerRss: 'unavailable-per-worker-thread';
        readonly indexAndCommitMs: typeof M3U_IMPORT_INDEX_COMMIT_UNAVAILABLE_REASON;
        readonly nativeAndSqliteMemory: 'included-in-main-rss-not-separately-attributable';
        readonly playlistRefreshWorker: 'not-used-by-initial-import';
    };
    readonly validity: {
        readonly databaseWorkerPeakMemory: DatabaseWorkerPeakMemoryValidity;
        readonly databaseWorkerPostGc: DatabaseWorkerPostGcValidity;
        readonly databaseWorkerRequestMetrics: DatabaseWorkerRequestMetricsValidity;
        readonly rendererRss: RendererRssValidity;
    };
}
