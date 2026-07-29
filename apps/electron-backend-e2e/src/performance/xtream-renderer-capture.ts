import type { CDPSession, ConsoleMessage, Page } from '@playwright/test';

import type {
    NumericDistribution,
    XtreamScenarioId,
} from './xtream-benchmark-contract';
import {
    assertRendererMeasurementWindow,
    createRendererArtifactCapture,
    disposeRendererDiagnosticCapture,
    type RendererArtifactCapture,
    type RendererHeapUsageSample,
    selectRendererPeakHeapUsedBytes,
    startRendererDiagnosticCapture,
    stopRendererDiagnosticCapture,
    takeRendererHeapSnapshot,
} from './m3u-import-renderer-artifacts';
import { summarizeNumbers } from './performance-statistics';
import {
    assertCompleteXtreamRendererProbe,
    beginXtreamRendererOperation,
    installXtreamRendererProbe,
    recordXtreamRendererHeartbeat,
    stopXtreamRendererProbe,
    type XtreamRendererProbeMetrics,
    waitForXtreamRendererTerminal,
} from './xtream-renderer-probe';
import {
    createXtreamRendererConsoleErrorBreakdown,
    recordXtreamRendererConsoleError,
    type XtreamRendererConsoleErrorBreakdown,
} from './xtream-renderer-console-errors';
import {
    assertFixedGridRendererHeartbeatCoverage,
    RENDERER_HEARTBEAT_INTERVAL_MS,
} from './renderer-heartbeat-fixed-grid';

export interface XtreamRendererCaptureOptions {
    readonly diagnostic: boolean;
    readonly outputDirectory: string;
    readonly scenarioId: XtreamScenarioId;
    readonly sourceTitle: string;
}

export interface XtreamRendererCaptureMetrics {
    readonly captureCutoffEpochMs: number;
    readonly consoleErrorBreakdown: XtreamRendererConsoleErrorBreakdown;
    readonly consoleErrorCount: number;
    readonly cpuProfilePath: string | null;
    readonly frameGap: NumericDistribution;
    readonly heapSnapshotPath: string | null;
    readonly heartbeatDelay: NumericDistribution;
    readonly longTask: NumericDistribution;
    readonly measurementStartEpochMs: number;
    readonly pageErrorCount: number;
    readonly peakHeapUsedBytes: number;
    readonly postGcHeapUsedBytes: number;
    readonly probe: XtreamRendererProbeMetrics;
    readonly storeToPaintMs: number;
    readonly targetId: string;
    readonly tracePath: string | null;
}

export interface RunningXtreamRendererCapture {
    beginOperation(): Promise<number>;
    dispose(): Promise<void>;
    readonly session: CDPSession;
    stop(): Promise<XtreamRendererCaptureMetrics>;
    readonly targetId: string;
    waitForTerminal(): Promise<void>;
}

interface HeapUsage {
    readonly usedSize: number;
}

interface TargetInfo {
    readonly targetId: string;
    readonly title: string;
    readonly type: string;
    readonly url: string;
}

export async function selectXtreamRendererTarget(
    session: Pick<CDPSession, 'send'>
): Promise<string> {
    const response = (await session.send('Target.getTargets')) as {
        readonly targetInfos?: readonly TargetInfo[];
    };
    const matches = (response.targetInfos ?? []).filter(
        ({ title, type, url }) =>
            type === 'page' &&
            !url.startsWith('devtools://') &&
            title.toLocaleLowerCase().includes('iptvnator') &&
            /\/workspace(?:\/|$)/.test(url)
    );
    if (matches.length !== 1 || !matches[0]) {
        throw new Error(`xtream-renderer-target-count:${matches.length}`);
    }
    return matches[0].targetId;
}

export async function startXtreamRendererCapture(
    page: Page,
    options: XtreamRendererCaptureOptions
): Promise<RunningXtreamRendererCapture> {
    const session = await page.context().newCDPSession(page);
    let targetId: string;
    try {
        targetId = await selectXtreamRendererTarget(session);
    } catch (error) {
        continueBestEffort(() => session.detach());
        throw error;
    }
    let consoleErrorCount = 0;
    const consoleErrorBreakdown = createXtreamRendererConsoleErrorBreakdown();
    let pageErrorCount = 0;
    const onConsole = (message: ConsoleMessage): void => {
        if (message.type() !== 'error') return;
        consoleErrorCount += 1;
        recordXtreamRendererConsoleError(
            consoleErrorBreakdown,
            options.scenarioId,
            message.text()
        );
    };
    const onPageError = (): void => {
        pageErrorCount += 1;
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);

    let artifacts: RendererArtifactCapture | null = null;
    let heapTimer: NodeJS.Timeout | null = null;
    let heapInFlight: Promise<void> | null = null;
    let heapError: unknown = null;
    let probeInstalled = false;
    const heapSamples: RendererHeapUsageSample[] = [];
    const sampleHeap = (): Promise<void> => {
        heapInFlight ??= (async () => {
            try {
                const sample = (await session.send(
                    'Runtime.getHeapUsage'
                )) as HeapUsage;
                if (Number.isFinite(sample.usedSize) && sample.usedSize >= 0) {
                    heapSamples.push({
                        epochMs: Date.now(),
                        usedSize: sample.usedSize,
                    });
                }
            } catch (error) {
                heapError ??= error;
            } finally {
                heapInFlight = null;
            }
        })();
        return heapInFlight;
    };

    try {
        await session.send('Runtime.enable');
        await session.send('Performance.enable');
        await installXtreamRendererProbe(page, options);
        probeInstalled = true;
        artifacts = createRendererArtifactCapture(options);
    } catch (error) {
        if (heapTimer) clearInterval(heapTimer);
        if (artifacts && options.diagnostic) {
            await disposeRendererDiagnosticCapture(session, artifacts).catch(
                () => undefined
            );
        }
        if (probeInstalled) {
            continueBestEffort(() => stopXtreamRendererProbe(page));
        }
        removePageErrorListeners(page, onConsole, onPageError);
        continueBestEffort(() => session.detach());
        throw error;
    }
    if (!artifacts) {
        throw new Error('xtream-renderer-capture-initialization-failed');
    }

    let stopped = false;
    let operationStarted = false;
    let measurementStartEpochMs: number | null = null;
    let heartbeatDeadlineEpochMs: number | null = null;
    let heartbeatError: unknown = null;
    let heartbeatInFlight: Promise<void> | null = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let stopPromise: Promise<XtreamRendererCaptureMetrics> | null = null;
    let disposePromise: Promise<void> | null = null;
    let detachPromise: Promise<void> | null = null;
    const detach = (): Promise<void> => {
        detachPromise ??= session.detach();
        return detachPromise;
    };
    const stopScheduling = (): void => {
        stopped = true;
        if (heartbeatTimer) {
            clearTimeout(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (heapTimer) {
            clearInterval(heapTimer);
            heapTimer = null;
        }
    };
    const scheduleHeartbeat = (): void => {
        if (stopped || heartbeatDeadlineEpochMs === null) return;
        const deadline = heartbeatDeadlineEpochMs;
        heartbeatTimer = setTimeout(
            () => {
                heartbeatTimer = null;
                if (stopped) return;
                heartbeatInFlight = recordXtreamRendererHeartbeat(
                    page,
                    deadline
                )
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
            heartbeatDeadlineEpochMs = await recordXtreamRendererHeartbeat(
                page,
                heartbeatDeadlineEpochMs
            );
        } catch (error) {
            heartbeatError ??= error;
        }
    };
    const stopCapture = async (): Promise<XtreamRendererCaptureMetrics> => {
        try {
            stopScheduling();
            const captureCutoffEpochMs = Date.now();
            if (measurementStartEpochMs === null) {
                throw new Error('xtream-renderer-operation-not-started');
            }
            await flushHeartbeat();
            if (options.diagnostic) {
                await stopRendererDiagnosticCapture(session, artifacts);
            }
            await heapInFlight;
            const probe = await stopXtreamRendererProbe(page);
            await session.send('HeapProfiler.enable');
            await session.send('HeapProfiler.collectGarbage');
            const postGc = (await session.send(
                'Runtime.getHeapUsage'
            )) as HeapUsage;
            if (options.diagnostic) {
                await takeRendererHeapSnapshot(
                    session,
                    artifacts.heapSnapshotPath
                );
            }
            await detach();
            removePageErrorListeners(page, onConsole, onPageError);
            throwIfError(heapError, 'xtream-renderer-heap-sampling-failed');
            throwIfError(heartbeatError, 'xtream-renderer-heartbeat-failed');
            assertCompleteXtreamRendererProbe(probe);
            assertFixedGridRendererHeartbeatCoverage(
                probe.heartbeatDelaysMs,
                probe.operationStartEpochMs,
                probe.terminalEpochMs
            );
            assertRendererMeasurementWindow({
                captureCutoffEpochMs,
                measurementStartEpochMs,
                operationStartEpochMs: probe.operationStartEpochMs,
                terminalEpochMs: probe.terminalEpochMs,
            });
            return Object.freeze({
                captureCutoffEpochMs,
                consoleErrorBreakdown: Object.freeze({
                    ...consoleErrorBreakdown,
                }),
                consoleErrorCount,
                cpuProfilePath: artifacts.cpuProfilePath,
                frameGap: summarizeNumbers(probe.frameGapsMs),
                heapSnapshotPath: artifacts.heapSnapshotPath,
                heartbeatDelay: summarizeNumbers(probe.heartbeatDelaysMs),
                longTask: summarizeNumbers(probe.longTasksMs),
                measurementStartEpochMs,
                pageErrorCount,
                peakHeapUsedBytes: selectRendererPeakHeapUsedBytes(
                    heapSamples,
                    measurementStartEpochMs,
                    probe.terminalEpochMs
                ),
                postGcHeapUsedBytes: postGc.usedSize,
                probe,
                storeToPaintMs:
                    probe.uiPaintedEpochMs - probe.storeTerminalEpochMs,
                targetId,
                tracePath: artifacts.tracePath,
            });
        } catch (error) {
            await dispose();
            throw error;
        }
    };
    const dispose = (): Promise<void> => {
        disposePromise ??= (async () => {
            stopScheduling();
            removePageErrorListeners(page, onConsole, onPageError);
            continueBestEffort(() => heartbeatInFlight ?? Promise.resolve());
            continueBestEffort(() => heapInFlight ?? Promise.resolve());
            continueBestEffort(() => stopXtreamRendererProbe(page));
            if (options.diagnostic) {
                await disposeRendererDiagnosticCapture(
                    session,
                    artifacts
                ).catch(() => undefined);
            }
            continueBestEffort(detach);
        })();
        return disposePromise;
    };

    return Object.freeze({
        beginOperation: async () => {
            if (stopped || operationStarted) {
                throw new Error('xtream-renderer-operation-already-started');
            }
            operationStarted = true;
            const startedAt = await beginXtreamRendererOperation(page);
            measurementStartEpochMs = startedAt;
            if (options.diagnostic) {
                await startRendererDiagnosticCapture(session, artifacts);
            }
            await sampleHeap();
            throwIfError(heapError, 'xtream-renderer-heap-sampling-failed');
            heapTimer = setInterval(() => void sampleHeap(), 20);
            heartbeatDeadlineEpochMs =
                startedAt + RENDERER_HEARTBEAT_INTERVAL_MS;
            scheduleHeartbeat();
            return startedAt;
        },
        dispose,
        session,
        stop: () => {
            if (disposePromise && !stopPromise) {
                return Promise.reject(
                    new Error('xtream-renderer-capture-disposed')
                );
            }
            stopPromise ??= stopCapture();
            return stopPromise;
        },
        targetId,
        waitForTerminal: () => waitForXtreamRendererTerminal(page),
    });
}

function removePageErrorListeners(
    page: Page,
    onConsole: (message: ConsoleMessage) => void,
    onPageError: () => void
): void {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
}

function throwIfError(error: unknown, label: string): void {
    if (error instanceof Error) throw error;
    if (error !== null) throw new Error(`${label}:${String(error)}`);
}

function continueBestEffort(work: () => Promise<unknown>): void {
    try {
        void work().catch(() => undefined);
    } catch {
        // The owning Electron process is closed after failed-iteration cleanup.
    }
}
