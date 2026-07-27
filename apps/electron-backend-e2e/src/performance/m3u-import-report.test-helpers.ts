/* eslint-disable max-lines -- The deterministic fixture keeps the full production-shaped import sequence visible. */
import type { M3uImportRendererCaptureMetrics } from './m3u-import-renderer-capture';
import type { MainCaptureMetrics } from './m3u-refresh-cancellation-contract';
import type { M3uImportBenchmarkManifest } from './m3u-import-summary';

export const TEST_M3U_CHANNEL_COUNT = 10_000;
export const TEST_M3U_FIXTURE_BYTES = 1_024_000;

export function createTestMainCapture(): MainCaptureMetrics {
    return {
        timeline: [
            mainPhase('start', 'data.acquire', 1001, null),
            mainPhase('end', 'data.acquire', 1021, 20, {
                byteCount: TEST_M3U_FIXTURE_BYTES,
            }),
            mainPhase('start', 'parse.m3u', 1021, null),
            mainPhase('end', 'parse.m3u', 1061, 40, {
                itemCount: TEST_M3U_CHANNEL_COUNT,
            }),
            mainPhase('start', 'normalize', 1061, null),
            mainPhase('end', 'normalize', 1071, 10, {
                itemCount: TEST_M3U_CHANNEL_COUNT,
            }),
            {
                epochMs: 1080,
                ipcCallId: 7,
                operation: 'DB_UPSERT_APP_PLAYLIST',
                playlistId: 'playlist-1',
                requestId: 'db-request-1',
                sourceEpochMs: 1079,
                type: 'db-request',
            },
            {
                epochMs: 1137,
                operation: 'DB_UPSERT_APP_PLAYLIST',
                playlistId: 'playlist-1',
                requestId: 'db-request-1',
                success: true,
                type: 'db-response',
            },
            {
                epochMs: 1140,
                ipcCallId: 7,
                operation: 'DB_UPSERT_APP_PLAYLIST',
                playlistId: 'playlist-1',
                sourceEpochMs: 1140,
                success: true,
                type: 'preload-performance-success',
            },
            {
                epochMs: 1142,
                ipcCallId: 8,
                operation: 'DB_GET_APP_PLAYLIST',
                playlistId: 'playlist-1',
                requestId: 'db-request-2',
                sourceEpochMs: 1141,
                type: 'db-request',
            },
            {
                epochMs: 1174,
                operation: 'DB_GET_APP_PLAYLIST',
                playlistId: 'playlist-1',
                requestId: 'db-request-2',
                success: true,
                type: 'db-response',
            },
            {
                epochMs: 1194,
                ipcCallId: 8,
                operation: 'DB_GET_APP_PLAYLIST',
                playlistId: 'playlist-1',
                sourceEpochMs: 1194,
                success: true,
                type: 'preload-performance-success',
            },
        ],
        workers: [
            {
                kind: 'database.worker',
                requests: [
                    {
                        ipcCallId: 7,
                        operation: 'DB_UPSERT_APP_PLAYLIST',
                        operationId: null,
                        operationIdUnavailableReason:
                            'preload-performance-marker-uncorrelated',
                        performanceCaptureUnavailableReason: null,
                        phaseEvents: [
                            workerPhase(
                                'start',
                                'serialize.playlist',
                                1082,
                                null,
                                'db-request-1'
                            ),
                            workerPhase(
                                'end',
                                'serialize.playlist',
                                1102,
                                20,
                                'db-request-1',
                                {
                                    itemCount: TEST_M3U_CHANNEL_COUNT,
                                }
                            ),
                            workerPhase(
                                'start',
                                'sqlite.write',
                                1102,
                                null,
                                'db-request-1'
                            ),
                            workerPhase(
                                'end',
                                'sqlite.write',
                                1132,
                                30,
                                'db-request-1',
                                {
                                    itemCount: 1,
                                }
                            ),
                        ],
                        playlistId: 'playlist-1',
                        requestId: 'db-request-1',
                        requestReceivedEpochMs: 1081,
                        responseEpochMs: 1137,
                        responsePostedEpochMs: 1135,
                        sourceEpochMs: 1079,
                        success: true,
                        workEndedEpochMs: 1133,
                        workStartedEpochMs: 1082,
                    },
                    {
                        ipcCallId: 8,
                        operation: 'DB_GET_APP_PLAYLIST',
                        operationId: null,
                        operationIdUnavailableReason:
                            'preload-performance-marker-uncorrelated',
                        performanceCaptureUnavailableReason: null,
                        phaseEvents: [
                            workerPhase(
                                'start',
                                'sqlite.read',
                                1144,
                                null,
                                'db-request-2'
                            ),
                            workerPhase(
                                'end',
                                'sqlite.read',
                                1149,
                                5,
                                'db-request-2',
                                {
                                    itemCount: 1,
                                }
                            ),
                            workerPhase(
                                'start',
                                'deserialize.playlist',
                                1149,
                                null,
                                'db-request-2'
                            ),
                            workerPhase(
                                'end',
                                'deserialize.playlist',
                                1161,
                                12,
                                'db-request-2',
                                {
                                    itemCount: TEST_M3U_CHANNEL_COUNT,
                                }
                            ),
                        ],
                        playlistId: 'playlist-1',
                        requestId: 'db-request-2',
                        requestReceivedEpochMs: 1143,
                        responseEpochMs: 1174,
                        responsePostedEpochMs: 1164,
                        sourceEpochMs: 1141,
                        success: true,
                        workEndedEpochMs: 1162,
                        workStartedEpochMs: 1144,
                    },
                ],
            },
        ],
    } as unknown as MainCaptureMetrics;
}

export function createTestRendererCapture(): M3uImportRendererCaptureMetrics {
    return {
        phaseTimestamps: {
            firstChannelVisibleEpochMs: 1210,
            operationStartEpochMs: 1000,
            routeReadyEpochMs: 1140,
            terminalEpochMs: 1215,
            uiPaintedEpochMs: 1215,
        },
        probe: {
            performancePhaseEvents: [
                rendererPhase(
                    'start',
                    'store.m3u-import-dispatch',
                    'renderer-1',
                    1076,
                    76
                ),
                rendererPhase(
                    'end',
                    'store.m3u-import-dispatch',
                    'renderer-1',
                    1078,
                    78
                ),
                rendererPhase(
                    'start',
                    'store.m3u-publish-channels',
                    'renderer-2',
                    1195,
                    195,
                    TEST_M3U_CHANNEL_COUNT
                ),
                rendererPhase(
                    'end',
                    'store.m3u-publish-channels',
                    'renderer-2',
                    1205,
                    205,
                    TEST_M3U_CHANNEL_COUNT
                ),
            ],
            playlistId: 'playlist-1',
        },
    } as unknown as M3uImportRendererCaptureMetrics;
}

export function createCompleteTestMainCapture(
    overrides: { mainRss?: number; rendererRss?: number } = {}
): MainCaptureMetrics {
    const base = createTestMainCapture();
    const databaseWorker = base.workers[0];
    const upsert = databaseWorker?.requests[0];
    const get = databaseWorker?.requests[1];
    if (!databaseWorker || !upsert || !get) {
        throw new Error('invalid-test-main-capture');
    }
    return {
        ...base,
        cpuProfilePath: null,
        cpuSystemMicros: 20,
        cpuUserMicros: 30,
        eventLoopDelay: { maxMs: 3, p95Ms: 1, p99Ms: 2 },
        eventLoopUtilization: null,
        eventLoopUtilizationUnavailableReason:
            'electron-main-embedded-event-loop',
        heapSnapshotPath: null,
        memory: {
            peakHeapUsedBytes: 2_000,
            peakRssBytes: overrides.mainRss ?? 5_000,
            postGcHeapUsedBytes: 1_000,
            postGcRssBytes: 4_500,
        },
        rendererWindow: {
            responsiveEvents: 0,
            rss: {
                identity: { creationTime: 100, pid: 42 },
                missingSampleCount: 0,
                peakRssBytes: overrides.rendererRss ?? 4_000,
                unavailableReason: null,
                validSampleCount: 5,
            },
            unresponsiveEvents: 0,
            windowIdentity: {
                browserWindowId: 1,
                webContentsId: 2,
            },
        },
        rssScope:
            'electron-main-process-including-worker-threads-and-native-memory',
        workers: [
            {
                ...databaseWorker,
                externalMemorySampleCount: 4,
                heapUsedSampleCount: 4,
                peakExternalBytes: 600,
                peakExternalUnavailableReason: null,
                peakHeapUsedBytes: 1_500,
                peakHeapUsedUnavailableReason: null,
                postGcHeapUnavailableReason: null,
                postGcHeapUsedBytes: 900,
                requests: [
                    {
                        ...upsert,
                        eventLoopDelay: { maxMs: 6, p95Ms: 4, p99Ms: 5 },
                        eventLoopDelayUnavailableReason: null,
                        eventLoopUtilization: 0.8,
                        eventLoopUtilizationUnavailableReason: null,
                        histogramFlushedEpochMs: 1134,
                        invalidReason: null,
                        threadCpuSystemMicros: 40,
                        threadCpuUnavailableReason: null,
                        threadCpuUserMicros: 50,
                    },
                    {
                        ...get,
                        eventLoopDelay: { maxMs: 9, p95Ms: 7, p99Ms: 8 },
                        eventLoopDelayUnavailableReason: null,
                        eventLoopUtilization: 0.9,
                        eventLoopUtilizationUnavailableReason: null,
                        histogramFlushedEpochMs: 1163,
                        invalidReason: null,
                        threadCpuSystemMicros: 60,
                        threadCpuUnavailableReason: null,
                        threadCpuUserMicros: 70,
                    },
                ],
            },
        ],
    };
}

export function createCompleteTestRendererCapture(
    overrides: { rendererHeap?: number } = {}
): M3uImportRendererCaptureMetrics {
    const base = createTestRendererCapture();
    return {
        ...base,
        cpuProfilePath: null,
        frameGap: distribution([16, 40]),
        heapSnapshotPath: null,
        heartbeatDelay: distribution([0, 5]),
        longTask: distribution([60]),
        peakHeapUsedBytes: overrides.rendererHeap ?? 3_000,
        postGcHeapUsedBytes: 1_100,
        probe: {
            ...base.probe,
            firstChannelVisibleEpochMs: 1210,
            frameGapsMs: [16, 40],
            heartbeatDelaysMs: [0, 5],
            longTasksMs: [60],
            operationStartEpochMs: 1000,
            routeReadyEpochMs: 1140,
            terminalEpochMs: 1215,
            uiPaintedEpochMs: 1215,
        },
        tracePath: null,
    };
}

export function createTestM3uImportManifest(): M3uImportBenchmarkManifest {
    return {
        channelCount: TEST_M3U_CHANNEL_COUNT,
        fixtureBytes: TEST_M3U_FIXTURE_BYTES,
        fixtureSha256: 'fixture-sha',
        gitCommit: 'commit',
        gitDiffSha256: 'diff',
        gitDirty: false,
        measuredRuns: 1,
        memoryAccounting: {
            databaseWorkerRss: 'unavailable-per-worker-thread',
            mainRss:
                'electron-main-process-including-worker-threads-and-native-memory',
            nativeAndSqliteMemory:
                'included-in-main-rss-not-separately-attributable',
            rendererRss: 'separate-renderer-process',
            workerJsHeap: 'separate-v8-isolate',
        },
        runtime: {
            arch: 'arm64',
            cdpPort: 9222,
            electronVersion: '1',
            harnessNodeVersion: '1',
            platform: 'darwin',
        },
        scenario: 'm3u-import-10k',
        syntheticSeed: 240_724,
        variant: 'baseline',
        warmupRuns: 1,
    };
}

function mainPhase(
    boundary: 'end' | 'start',
    phase: string,
    epochMs: number,
    durationMs: number | null,
    metadata: { byteCount?: number; itemCount?: number } = {}
) {
    return {
        boundary,
        durationMs,
        epochMs,
        ...metadata,
        phase,
        requestId: 'main-request-1',
        type: 'm3u-import-phase',
    };
}

function workerPhase(
    boundary: 'end' | 'start',
    phase:
        | 'deserialize.playlist'
        | 'serialize.playlist'
        | 'sqlite.read'
        | 'sqlite.write',
    epochMs: number,
    durationMs: number | null,
    requestId: string,
    metadata?: { byteCount?: number; itemCount?: number }
) {
    return {
        boundary,
        durationMs,
        epochMs,
        ...(metadata ? { metadata } : {}),
        phase,
        requestId,
    };
}

function rendererPhase(
    boundary: 'end' | 'start',
    phase: 'store.m3u-import-dispatch' | 'store.m3u-publish-channels',
    phaseId: string,
    epochMs: number,
    monotonicMs: number,
    items?: number
) {
    return {
        boundary,
        epochMs,
        ...(items === undefined ? {} : { metadata: { items } }),
        monotonicMs,
        ...(boundary === 'end' ? { outcome: 'success' as const } : {}),
        phase,
        phaseId,
        schemaVersion: 1 as const,
    };
}

function distribution(values: readonly number[]) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
        count: values.length,
        max,
        mean,
        median: mean,
        min,
        p95: values.length === 1 ? max : min + (max - min) * 0.95,
        p99: values.length === 1 ? max : min + (max - min) * 0.99,
    };
}
