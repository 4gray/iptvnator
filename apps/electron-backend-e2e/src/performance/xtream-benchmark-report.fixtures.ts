import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    XTREAM_ITERATION_KIND,
    XTREAM_SCENARIO_ID,
    type XtreamIterationDefinition,
} from './xtream-benchmark-contract';
import {
    computeXtreamBuildFilesAggregate,
    type XtreamBenchmarkBuildIdentity,
    type XtreamBuildFileIdentity,
} from './xtream-build-identity';
import { persistThenValidateXtreamIteration } from './xtream-benchmark-report';
import { bindFixtureCancellationEvidence } from './xtream-cancellation-evidence.fixture';
import { bindFixtureIpcWorkerIdentities } from './xtream-ipc-worker-identity.fixture';
import { scenarioCapture } from './xtream-phase-attribution.fixtures';
import { attributeXtreamPhases } from './xtream-phase-attribution';
import {
    XTREAM_MEMORY_ACCOUNTING,
    type XtreamArtifactSafetyContext,
    type XtreamBenchmarkManifest,
    type XtreamPersistenceReceipt,
    type XtreamRawIterationResult,
    type XtreamValidatedIterationResult,
} from './xtream-summary-contract';
import {
    invalidateWorkerRequestMetrics,
    workerRequestEvidence,
} from './xtream-worker-request-evidence.fixtures';
import { bindFixtureWorkerEvidence } from './xtream-worker-phase-evidence.fixture';
import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';

export const TOKEN = 'random-control-token-that-must-never-persist';
const buildFile = (path: string, marker: string): XtreamBuildFileIdentity => ({
    bytes: marker.length,
    path,
    sha256: sha256(marker),
});
const rendererFiles = [
    buildFile('dist/apps/web/index.html', 'renderer-index'),
    buildFile('dist/apps/web/main-FIXTURE.js', 'renderer-javascript'),
    buildFile('dist/apps/web/main-FIXTURE.js.map', 'renderer-source-map'),
] as const;
export const BUILD_IDENTITY: XtreamBenchmarkBuildIdentity = {
    electron: {
        databaseWorker: {
            javascript: buildFile(
                'dist/apps/electron-backend/workers/database.worker.js',
                'database-worker-javascript'
            ),
            sourceMap: buildFile(
                'dist/apps/electron-backend/workers/database.worker.js.map',
                'database-worker-source-map'
            ),
        },
        main: {
            javascript: buildFile(
                'dist/apps/electron-backend/main.js',
                'main-javascript'
            ),
            sourceMap: buildFile(
                'dist/apps/electron-backend/main.js.map',
                'main-source-map'
            ),
        },
        playlistRefreshWorker: {
            javascript: buildFile(
                'dist/apps/electron-backend/workers/playlist-refresh.worker.js',
                'playlist-worker-javascript'
            ),
            sourceMap: buildFile(
                'dist/apps/electron-backend/workers/playlist-refresh.worker.js.map',
                'playlist-worker-source-map'
            ),
        },
        preload: {
            javascript: buildFile(
                'dist/apps/electron-backend/main.preload.js',
                'preload-javascript'
            ),
            sourceMap: buildFile(
                'dist/apps/electron-backend/main.preload.js.map',
                'preload-source-map'
            ),
        },
    },
    renderer: {
        aggregateSha256: computeXtreamBuildFilesAggregate(rendererFiles),
        bytes: rendererFiles.reduce((total, file) => total + file.bytes, 0),
        executableJavaScriptCount: 1,
        files: rendererFiles,
        sourceMapCount: 1,
    },
};
const SAFETY: XtreamArtifactSafetyContext = {
    controlToken: TOKEN,
    syntheticCredentials: {
        password: 'performance',
        username: 'performance',
    },
};
export const MANIFEST: XtreamBenchmarkManifest = {
    build: BUILD_IDENTITY,
    environment: {
        cdpAddress: '127.0.0.1',
        cdpPort: 9222,
        databaseWorkerBatchDelayMs: 0,
        exposeGc: true,
        freshUserDataPerIteration: true,
        perfCapture: '1',
        perfWorkerProfiling: '1',
        traceRendererConsole: '0',
    },
    fixture: {
        bytes: 12_345,
        catalogSha256: hash('1'),
        categories: 100,
        items: 100_000,
        scenario: 'performance-100k',
        seed: 91_001,
    },
    memoryAccounting: XTREAM_MEMORY_ACCOUNTING,
    mode: 'formal',
    runtime: {
        arch: 'arm64',
        electronVersion: '38.0.0',
        harnessNodeVersion: '22.0.0',
        platform: 'darwin',
    },
    source: {
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        gitDiffSha256: hash('2'),
        gitDirty: false,
    },
    suite: 'xtream-performance-100k',
    variant: 'baseline',
};
const directories: string[] = [];
export async function clearXtreamReportFixtureDirectories(): Promise<void> {
    await Promise.all(
        directories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true }))
    );
}

export async function persist(
    raw: XtreamRawIterationResult,
    id: number,
    afterWrite?: () => void
): Promise<XtreamValidatedIterationResult> {
    return persistWith(raw, async (serialized) => {
        const directory = await mkdtemp(
            join(tmpdir(), `iptvnator-xtream-raw-${id}-`)
        );
        directories.push(directory);
        const absolutePath = join(directory, 'raw.json');
        await writeFile(absolutePath, serialized, 'utf8');
        afterWrite?.();
        return {
            absolutePath,
            bytes: Buffer.byteLength(serialized),
            sha256: sha256(serialized),
        };
    });
}

export function persistWith(
    raw: XtreamRawIterationResult,
    write: (serialized: string) => Promise<XtreamPersistenceReceipt>
): Promise<XtreamValidatedIterationResult> {
    return persistThenValidateXtreamIteration(raw, SAFETY, write);
}

export function iteration(
    definition: XtreamIterationDefinition,
    identity: number
): XtreamRawIterationResult {
    const diagnostic = definition.kind === XTREAM_ITERATION_KIND.DIAGNOSTIC;
    const background =
        definition.scenarioId === XTREAM_SCENARIO_ID.BACKGROUND_UI;
    const workerBinding = bindFixtureWorkerEvidence(
        scenarioCapture(definition.scenarioId),
        workerRequestEvidence(definition.scenarioId)
    );
    const cancellationBinding = bindFixtureCancellationEvidence(
        workerBinding.phaseCapture,
        workerBinding.requests
    );
    const ipcWorkerBinding = bindFixtureIpcWorkerIdentities(
        cancellationBinding.phaseCapture,
        workerBinding.requests
    );
    const phaseCapture = ipcWorkerBinding.phaseCapture;
    const phases = attributeXtreamPhases(phaseCapture);
    const requestEvidence = ipcWorkerBinding.requests;
    const capturedRequestEvidence = background
        ? invalidateWorkerRequestMetrics(requestEvidence, 3)
        : requestEvidence;
    const requestTotalCount = requestEvidence.length;
    const profile = {
        cpuProfileDurationMicros: diagnostic ? 2_000 : null,
        cpuProfileUnavailableReason: diagnostic
            ? null
            : 'not-captured-outside-diagnostic',
    } as const;
    return {
        ...definition,
        processIdentity: {
            captureGeneration: 1,
            electronPid: 10_000 + identity,
            freshProcess: true,
            generationIdentitySha256: numberedHash(identity, 3),
            launchId: `launch-${identity}`,
            profileDirectorySha256: numberedHash(identity, 4),
        },
        phaseCapture,
        phases,
        renderer: {
            ...profile,
            actionLatencyMs: background ? 7 : null,
            consoleErrors: [],
            dashboardPaintVisibility: background
                ? 'visible-without-overlay'
                : null,
            frameGapMaxMs: 45,
            frameGapP95Ms: 20,
            heartbeatMaxMs: 12,
            heartbeatP95Ms: 5,
            longTaskCount: 2,
            longTaskMaxMs: 75,
            navigationLatencyMs: background ? 8 : null,
            peakHeapUsedBytes: 300,
            peakRssBytes: 500,
            postGcHeapUsedBytes: 200,
            searchLatencyMs: background ? 9 : null,
            storeToPaintMs: phases.angularRenderingMs,
            targetId: `renderer-${identity}`,
        },
        main: {
            ...profile,
            browserWindowId: 1,
            cpuMetricScope: 'electron-main-thread',
            cpuSystemMicros: 200,
            cpuUserMicros: 1_000,
            eventLoopDelayMaxMs: 8,
            eventLoopDelayP95Ms: 2,
            eventLoopDelayP99Ms: 4,
            eventLoopUtilization: null,
            eventLoopUtilizationUnavailableReason:
                'electron-main-embedded-event-loop',
            peakHeapUsedBytes: 400,
            peakRssBytes: 1_000,
            postGcHeapUsedBytes: 250,
            responsiveEvents: 0,
            unresponsiveEvents: 0,
            webContentsId: 2,
        },
        databaseWorker: {
            ...profile,
            cpuMetricScope: 'sum-valid-request-thread-cpu',
            cpuSystemMicros:
                capturedRequestEvidence.filter(
                    ({ invalidReason }) => invalidReason === null
                ).length * 10,
            cpuUserMicros:
                capturedRequestEvidence.filter(
                    ({ invalidReason }) => invalidReason === null
                ).length * 20,
            currentForCapture: true,
            eventLoopDelayMaxMs: 9,
            eventLoopDelayMetricScope: 'valid-request-window-proxy',
            eventLoopDelayP95Ms: 3,
            eventLoopDelayP99Ms: 5,
            eventLoopUtilization: 0.6,
            kind: 'database.worker',
            ordinal: 1,
            peakExternalBytes: 40,
            peakHeapUsedBytes: 250,
            postGcHeapUsedBytes: 150,
            requests: {
                evidence: capturedRequestEvidence,
                eventLoopDelayMaxMs: 9,
                eventLoopDelayP95Ms: 3,
                eventLoopDelayP99Ms: 5,
                eventLoopUtilization: 0.5,
                invalidReasons: background
                    ? [
                          {
                              count: 3,
                              reason: 'overlapping-database-worker-requests',
                          },
                      ]
                    : [],
                invalidSampleCount: background ? 3 : 0,
                metricScope: 'valid-request-window-proxy',
                totalCount: requestTotalCount,
                validSampleCount: requestTotalCount - (background ? 3 : 0),
            },
            rssBytes: null,
            rssUnavailableReason: 'unavailable-per-worker-thread',
            wholeWorkerMetricScope: 'whole-worker-operation-window',
        },
        playlistRefreshWorker: {
            instantiated: false,
            reason: 'not-instantiated-by-xtream-flow',
        },
        cancellation: cancellationBinding.cancellation,
        cancellationEvidence: cancellationBinding.cancellationEvidence,
        catalogVerification: {
            databaseStateValid: true,
            fixtureIdentityValid: true,
            providerCategoryCount: 100,
            providerItemCount: 100_000,
            verifiedAfterCapture: true,
        },
        validity: {
            actionContractValid: true,
            catalogContractValid: true,
            databaseWorkerCount: 1,
            dbPhaseContractValid: true,
            diagnosticArtifactsValid: diagnostic ? true : null,
            lateDatabaseRequestCount: 0,
            playlistWorkerCount: 0,
            rendererTargetCount: 1,
        },
    };
}

export function withWorkerRequestOverlap(
    raw: XtreamRawIterationResult,
    invalidSampleCount: number
): XtreamRawIterationResult {
    return {
        ...raw,
        databaseWorker: {
            ...raw.databaseWorker,
            requests: {
                ...raw.databaseWorker.requests,
                evidence: invalidateWorkerRequestMetrics(
                    raw.databaseWorker.requests.evidence.map(
                        restoreValidRequestMetrics
                    ),
                    invalidSampleCount
                ),
                invalidReasons:
                    invalidSampleCount === 0
                        ? []
                        : [
                              {
                                  count: invalidSampleCount,
                                  reason: 'overlapping-database-worker-requests',
                              },
                          ],
                invalidSampleCount,
                validSampleCount:
                    raw.databaseWorker.requests.totalCount - invalidSampleCount,
            },
        },
    };
}

function restoreValidRequestMetrics(
    request: WorkerRequestPerformanceMetrics
): WorkerRequestPerformanceMetrics {
    if (
        request.workEndedEpochMs === null ||
        request.responsePostedEpochMs === null
    ) {
        throw new Error('invalid Xtream request fixture');
    }
    return {
        ...request,
        eventLoopDelay: { maxMs: 9, p95Ms: 3, p99Ms: 5 },
        eventLoopDelayUnavailableReason: null,
        eventLoopUtilization: 0.5,
        eventLoopUtilizationUnavailableReason: null,
        histogramFlushedEpochMs:
            (request.workEndedEpochMs + request.responsePostedEpochMs) / 2,
        invalidReason: null,
        threadCpuSystemMicros: 10,
        threadCpuUnavailableReason: null,
        threadCpuUserMicros: 20,
    };
}

export function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function hash(character: string): string {
    return character.repeat(64);
}

function numberedHash(value: number, salt: number): string {
    return sha256(`${salt}:${value}`);
}
