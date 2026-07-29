import type { CDPSession, Page } from '@playwright/test';

import type { NumericDistribution } from './m3u-refresh-cancellation-contract';
import {
    createRendererArtifactCapture,
    disposeRendererDiagnosticCapture,
    type RendererArtifactCapture,
    startRendererDiagnosticCapture,
    stopRendererDiagnosticCapture,
    takeRendererHeapSnapshot,
} from './m3u-import-renderer-artifacts';
import {
    installM3uImportRendererProbe,
    type M3uImportRendererProbeMetrics,
    prepareM3uImportDialog,
    recordM3uImportHeartbeat,
    stopM3uImportRendererProbe,
    triggerM3uImport,
    waitForM3uImportTerminal,
} from './m3u-import-renderer-probe';
import { summarizeNumbers } from './performance-statistics';
import {
    assertFixedGridRendererHeartbeatCoverage,
    RENDERER_HEARTBEAT_INTERVAL_MS,
} from './renderer-heartbeat-fixed-grid';

export interface M3uImportRendererCaptureStartOptions {
    readonly diagnostic: boolean;
    readonly outputDirectory: string;
    readonly playlistTitle: string;
    readonly playlistUrl: string;
}

export interface M3uImportRendererPhaseTimestamps {
    readonly firstChannelVisibleEpochMs: number;
    readonly operationStartEpochMs: number;
    readonly routeReadyEpochMs: number;
    readonly terminalEpochMs: number;
    readonly uiPaintedEpochMs: number;
}

export interface M3uImportRendererCaptureMetrics {
    readonly cpuProfilePath: string | null;
    readonly frameGap: NumericDistribution;
    readonly heapSnapshotPath: string | null;
    readonly heartbeatDelay: NumericDistribution;
    readonly longTask: NumericDistribution;
    readonly peakHeapUsedBytes: number;
    readonly phaseTimestamps: M3uImportRendererPhaseTimestamps;
    readonly postGcHeapUsedBytes: number;
    readonly probe: M3uImportRendererProbeMetrics;
    readonly tracePath: string | null;
}

export interface RunningM3uImportRendererCapture {
    readonly session: CDPSession;
    dispose(): Promise<void>;
    stop(): Promise<M3uImportRendererCaptureMetrics>;
    triggerImport(): Promise<number>;
    waitForTerminal(): Promise<void>;
}

interface HeapUsageResult {
    readonly usedSize: number;
}

export async function startM3uImportRendererCapture(
    page: Page,
    options: M3uImportRendererCaptureStartOptions
): Promise<RunningM3uImportRendererCapture> {
    await prepareM3uImportDialog(page, options);
    const session = await page.context().newCDPSession(page);
    let probeInstalled = false;
    let heapSampleTimer: NodeJS.Timeout | null = null;
    let artifacts: RendererArtifactCapture | null = null;
    const heapSamples: number[] = [];
    let heapSampleError: unknown = null;
    let heapSamplePromise: Promise<void> | null = null;
    const sampleHeap = (): Promise<void> => {
        heapSamplePromise ??= (async () => {
            try {
                const sample = (await session.send(
                    'Runtime.getHeapUsage'
                )) as HeapUsageResult;
                if (Number.isFinite(sample.usedSize)) {
                    heapSamples.push(sample.usedSize);
                }
            } catch (error) {
                heapSampleError ??= error;
            } finally {
                heapSamplePromise = null;
            }
        })();
        return heapSamplePromise;
    };

    try {
        await session.send('Runtime.enable');
        await session.send('Performance.enable');
        await installM3uImportRendererProbe(page);
        probeInstalled = true;
        await sampleHeap();
        throwCaptureError(heapSampleError, 'Renderer heap sampling failed');
        heapSampleTimer = setInterval(() => void sampleHeap(), 20);
        artifacts = createRendererArtifactCapture(options);
        if (options.diagnostic) {
            await startRendererDiagnosticCapture(session, artifacts);
        }
    } catch (error) {
        if (heapSampleTimer) {
            clearInterval(heapSampleTimer);
            heapSampleTimer = null;
        }
        if (artifacts && options.diagnostic) {
            await disposeRendererDiagnosticCapture(
                session,
                artifacts
            ).catch(() => undefined);
        }
        if (probeInstalled) {
            continueBestEffort(() => stopM3uImportRendererProbe(page));
        }
        continueBestEffort(() => session.detach());
        throw error;
    }
    if (!artifacts || !heapSampleTimer) {
        throw new Error('M3U import renderer capture initialization failed');
    }

    let heartbeatDeadlineEpochMs: number | null = null;
    let heartbeatError: unknown = null;
    let heartbeatInFlight: Promise<void> | null = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let stopped = false;
    let backgroundStopPromise: Promise<void> | null = null;
    let probeStopPromise: Promise<M3uImportRendererProbeMetrics> | null = null;
    let sessionDetachPromise: Promise<void> | null = null;
    let abortPromise: Promise<void> | null = null;
    let stopPromise: Promise<M3uImportRendererCaptureMetrics> | null = null;
    let stopRequested = false;
    let disposeRequested = false;
    const stopSchedulingBackgroundWork = (): void => {
        stopped = true;
        if (heartbeatTimer) {
            clearTimeout(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (heapSampleTimer) {
            clearInterval(heapSampleTimer);
            heapSampleTimer = null;
        }
    };
    const scheduleHeartbeat = (): void => {
        if (stopped || heartbeatDeadlineEpochMs === null) {
            return;
        }
        const deadline = heartbeatDeadlineEpochMs;
        heartbeatTimer = setTimeout(
            () => {
                heartbeatTimer = null;
                if (stopped) {
                    return;
                }
                heartbeatInFlight = recordM3uImportHeartbeat(page, deadline)
                    .then((nextDeadlineEpochMs) => {
                        heartbeatDeadlineEpochMs = nextDeadlineEpochMs;
                    })
                    .catch((error: unknown) => {
                        heartbeatError ??= error;
                    })
                    .finally(() => {
                        heartbeatInFlight = null;
                        const gridClosed =
                            heartbeatDeadlineEpochMs === deadline;
                        if (stopped || heartbeatError !== null || gridClosed)
                            return;
                        scheduleHeartbeat();
                    });
            },
            Math.max(0, deadline - Date.now())
        );
    };
    const flushHeartbeat = async (): Promise<void> => {
        await heartbeatInFlight;
        if (
            heartbeatError !== null ||
            heartbeatDeadlineEpochMs === null
        ) {
            return;
        }
        try {
            heartbeatDeadlineEpochMs = await recordM3uImportHeartbeat(
                page,
                heartbeatDeadlineEpochMs
            );
        } catch (error) {
            heartbeatError ??= error;
        }
    };
    const stopBackgroundWork = (): Promise<void> => {
        backgroundStopPromise ??= (async () => {
            stopSchedulingBackgroundWork();
            await flushHeartbeat();
            await heapSamplePromise;
            await sampleHeap();
        })();
        return backgroundStopPromise;
    };
    const stopProbe = (): Promise<M3uImportRendererProbeMetrics> => {
        probeStopPromise ??= stopM3uImportRendererProbe(page);
        return probeStopPromise;
    };
    const detachSession = (): Promise<void> => {
        sessionDetachPromise ??= session.detach();
        return sessionDetachPromise;
    };
    const abortResources = (): Promise<void> => {
        abortPromise ??= (async () => {
            stopSchedulingBackgroundWork();
            continueBestEffort(() => heartbeatInFlight ?? Promise.resolve());
            continueBestEffort(() => heapSamplePromise ?? Promise.resolve());
            continueBestEffort(stopProbe);
            if (options.diagnostic) {
                await disposeRendererDiagnosticCapture(
                    session,
                    artifacts
                ).catch(() => undefined);
            }
            continueBestEffort(detachSession);
        })();
        return abortPromise;
    };
    const stopCapture =
        async (): Promise<M3uImportRendererCaptureMetrics> => {
            try {
                await stopBackgroundWork();
                let probe: M3uImportRendererProbeMetrics | null = null;
                let probeError: unknown = null;
                try {
                    probe = await stopProbe();
                } catch (error) {
                    probeError = error;
                }

                if (options.diagnostic) {
                    await stopRendererDiagnosticCapture(session, artifacts);
                }
                await session.send('HeapProfiler.enable');
                await session.send('HeapProfiler.collectGarbage');
                const postGc = (await session.send(
                    'Runtime.getHeapUsage'
                )) as HeapUsageResult;
                if (options.diagnostic) {
                    await takeRendererHeapSnapshot(
                        session,
                        artifacts.heapSnapshotPath
                    );
                }
                await detachSession();
                throwCaptureError(
                    heapSampleError,
                    'Renderer heap sampling failed'
                );
                throwCaptureError(heartbeatError, 'Renderer heartbeat failed');
                throwCaptureError(probeError, 'Renderer probe stop failed');
                assertCompleteM3uImportRendererProbe(probe);
                assertFixedGridRendererHeartbeatCoverage(
                    probe.heartbeatDelaysMs,
                    probe.operationStartEpochMs,
                    probe.terminalEpochMs
                );
                return Object.freeze({
                    cpuProfilePath: artifacts.cpuProfilePath,
                    frameGap: summarizeNumbers(probe.frameGapsMs),
                    heapSnapshotPath: artifacts.heapSnapshotPath,
                    heartbeatDelay: summarizeNumbers(
                        probe.heartbeatDelaysMs
                    ),
                    longTask: summarizeNumbers(probe.longTasksMs),
                    peakHeapUsedBytes: Math.max(0, ...heapSamples),
                    phaseTimestamps: Object.freeze({
                        firstChannelVisibleEpochMs:
                            probe.firstChannelVisibleEpochMs,
                        operationStartEpochMs: probe.operationStartEpochMs,
                        routeReadyEpochMs: probe.routeReadyEpochMs,
                        terminalEpochMs: probe.terminalEpochMs,
                        uiPaintedEpochMs: probe.uiPaintedEpochMs,
                    }),
                    postGcHeapUsedBytes: postGc.usedSize,
                    probe,
                    tracePath: artifacts.tracePath,
                });
            } catch (error) {
                await abortResources();
                throw error;
            }
        };

    return Object.freeze({
        dispose: async () => {
            disposeRequested = true;
            if (stopPromise) {
                continueBestEffort(() => stopPromise as Promise<unknown>);
            }
            await abortResources();
        },
        session,
        stop: () => {
            if (stopRequested || disposeRequested) {
                return Promise.reject(
                    new Error('M3U import renderer capture already stopped')
                );
            }
            stopRequested = true;
            stopPromise = stopCapture();
            return stopPromise;
        },
        triggerImport: async () => {
            const operationStartEpochMs = await triggerM3uImport(page);
            heartbeatDeadlineEpochMs =
                operationStartEpochMs + RENDERER_HEARTBEAT_INTERVAL_MS;
            scheduleHeartbeat();
            return operationStartEpochMs;
        },
        waitForTerminal: () => waitForM3uImportTerminal(page),
    });
}

export function assertCompleteM3uImportRendererProbe(
    probe: M3uImportRendererProbeMetrics | null | undefined
): asserts probe is M3uImportRendererProbeMetrics & {
    readonly firstChannelVisibleEpochMs: number;
    readonly playlistId: string;
    readonly routeReadyEpochMs: number;
    readonly terminalEpochMs: number;
    readonly uiPaintedEpochMs: number;
} {
    if (
        !probe ||
        typeof probe.playlistId !== 'string' ||
        probe.playlistId.length === 0 ||
        !isPositiveFinite(probe.operationStartEpochMs) ||
        !isPositiveFinite(probe.routeReadyEpochMs) ||
        !isPositiveFinite(probe.firstChannelVisibleEpochMs) ||
        !isPositiveFinite(probe.uiPaintedEpochMs) ||
        !isPositiveFinite(probe.terminalEpochMs)
    ) {
        throw new Error('m3u-import-renderer-probe-incomplete');
    }
    if (
        probe.routeReadyEpochMs < probe.operationStartEpochMs ||
        probe.firstChannelVisibleEpochMs < probe.routeReadyEpochMs ||
        probe.uiPaintedEpochMs < probe.firstChannelVisibleEpochMs ||
        probe.terminalEpochMs < probe.uiPaintedEpochMs
    ) {
        throw new Error('m3u-import-renderer-probe-incomplete');
    }
}

function throwCaptureError(error: unknown, label: string): void {
    if (error instanceof Error) {
        throw error;
    }
    if (error !== null) {
        throw new Error(`${label}: ${String(error)}`);
    }
}

function continueBestEffort(work: () => Promise<unknown>): void {
    try {
        void work().catch(() => undefined);
    } catch {
        // The owning Electron app is closed immediately after abort cleanup.
    }
}

function isPositiveFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
