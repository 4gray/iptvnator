/* eslint-disable max-lines -- Renderer CDP and injected-page lifecycle are kept together so raw artifact boundaries stay auditable. */
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';

import type { CDPSession, Page } from '@playwright/test';

import type {
    RendererCaptureMetrics,
    RendererProbeMetrics,
} from './m3u-refresh-cancellation-contract';
import { summarizeNumbers } from './performance-statistics';

const RENDERER_CAPTURE_STATE_KEY = '__iptvnatorM3uRefreshRendererCapture';
const HEARTBEAT_INTERVAL_MS = 50;

export interface RendererCaptureStartOptions {
    readonly diagnostic: boolean;
    readonly outputDirectory: string;
    readonly sourceTitle: string;
}

export interface RunningRendererCapture {
    readonly session: CDPSession;
    markOperationStart(): Promise<number>;
    stop(): Promise<RendererCaptureMetrics>;
    waitForCancelClick(): Promise<void>;
    waitForTerminal(): Promise<void>;
}

interface HeapUsageResult {
    readonly usedSize: number;
}

interface TraceData {
    readonly value: readonly unknown[];
}

export async function startRendererCapture(
    page: Page,
    options: RendererCaptureStartOptions
): Promise<RunningRendererCapture> {
    const session = await page.context().newCDPSession(page);
    await session.send('Runtime.enable');
    await session.send('Performance.enable');
    await installRendererProbe(page, options.sourceTitle);

    const heapSamples: number[] = [];
    let heapSampleBusy = false;
    let heapSampleError: unknown = null;
    const sampleHeap = async (): Promise<void> => {
        if (heapSampleBusy) {
            return;
        }
        heapSampleBusy = true;
        try {
            const result = (await session.send(
                'Runtime.getHeapUsage'
            )) as HeapUsageResult;
            if (Number.isFinite(result.usedSize)) {
                heapSamples.push(result.usedSize);
            }
        } catch (error) {
            heapSampleError ??= error;
        } finally {
            heapSampleBusy = false;
        }
    };
    await sampleHeap();
    throwHeapSampleError(heapSampleError);
    const heapSampleTimer = setInterval(() => void sampleHeap(), 20);

    const cpuProfilePath = options.diagnostic
        ? join(options.outputDirectory, 'renderer.cpuprofile')
        : null;
    const heapSnapshotPath = options.diagnostic
        ? join(options.outputDirectory, 'renderer.heapsnapshot')
        : null;
    const tracePath = options.diagnostic
        ? join(options.outputDirectory, 'renderer.trace.json')
        : null;
    let traceOutput: ReturnType<typeof createWriteStream> | null = null;
    let traceFirstEvent = true;
    let resolveTraceComplete: (() => void) | null = null;
    const traceComplete = new Promise<void>((resolve) => {
        resolveTraceComplete = resolve;
    });
    const onTraceData = (data: TraceData): void => {
        if (!traceOutput) {
            return;
        }
        for (const event of data.value) {
            traceOutput.write(
                `${traceFirstEvent ? '' : ','}${JSON.stringify(event)}`
            );
            traceFirstEvent = false;
        }
    };
    const onTraceComplete = (): void => {
        resolveTraceComplete?.();
        resolveTraceComplete = null;
    };

    if (options.diagnostic) {
        await session.send('Profiler.enable');
        await session.send('Profiler.start');
        traceOutput = createWriteStream(
            requireArtifactPath(tracePath, 'renderer trace'),
            { flags: 'wx', mode: 0o600 }
        );
        traceOutput.write('{"traceEvents":[');
        session.on('Tracing.dataCollected', onTraceData);
        session.on('Tracing.tracingComplete', onTraceComplete);
        await session.send('Tracing.start', {
            categories: [
                'blink.user_timing',
                'devtools.timeline',
                'disabled-by-default-devtools.timeline',
                'disabled-by-default-v8.cpu_profiler',
                'v8',
            ].join(','),
            options: 'sampling-frequency=1000',
            transferMode: 'ReportEvents',
        });
    }

    let stopped = false;
    return Object.freeze({
        session,
        markOperationStart: () => markRendererOperationStart(page),
        stop: async () => {
            if (stopped) {
                throw new Error('Renderer capture was already stopped');
            }
            stopped = true;
            const probe = await stopRendererProbe(page);
            clearInterval(heapSampleTimer);
            await sampleHeap();
            throwHeapSampleError(heapSampleError);

            if (options.diagnostic) {
                const cpuProfile = await session.send('Profiler.stop');
                await writeFile(
                    requireArtifactPath(cpuProfilePath, 'renderer CPU profile'),
                    JSON.stringify(cpuProfile['profile']),
                    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
                );
                await session.send('Tracing.end');
                await traceComplete;
                session.off('Tracing.dataCollected', onTraceData);
                session.off('Tracing.tracingComplete', onTraceComplete);
                traceOutput?.write(']}');
                traceOutput?.end();
                if (traceOutput) {
                    await finished(traceOutput);
                }
            }

            await session.send('HeapProfiler.enable');
            await session.send('HeapProfiler.collectGarbage');
            const postGc = (await session.send(
                'Runtime.getHeapUsage'
            )) as HeapUsageResult;

            if (options.diagnostic) {
                const output = createWriteStream(
                    requireArtifactPath(
                        heapSnapshotPath,
                        'renderer heap snapshot'
                    ),
                    { flags: 'wx', mode: 0o600 }
                );
                const onSnapshotChunk = (message: {
                    readonly chunk: string;
                }): void => {
                    output.write(message.chunk);
                };
                session.on(
                    'HeapProfiler.addHeapSnapshotChunk',
                    onSnapshotChunk
                );
                await session.send('HeapProfiler.takeHeapSnapshot', {
                    reportProgress: false,
                });
                session.off(
                    'HeapProfiler.addHeapSnapshotChunk',
                    onSnapshotChunk
                );
                output.end();
                await finished(output);
            }

            await session.detach();
            return Object.freeze({
                cpuProfilePath,
                frameGap: summarizeNumbers(probe.frameGapsMs),
                heapSnapshotPath,
                heartbeatDelay: summarizeNumbers(probe.heartbeatDelaysMs),
                longTask: summarizeNumbers(probe.longTasksMs),
                peakHeapUsedBytes: Math.max(0, ...heapSamples),
                postGcHeapUsedBytes: postGc.usedSize,
                probe,
                tracePath,
            });
        },
        waitForCancelClick: () =>
            page
                .waitForFunction(
                    (stateKey) => {
                        const target = globalThis as unknown as Record<
                            string,
                            unknown
                        >;
                        const state = target[stateKey] as
                            { cancelClickEpochMs: number | null } | undefined;
                        return typeof state?.cancelClickEpochMs === 'number';
                    },
                    RENDERER_CAPTURE_STATE_KEY,
                    { timeout: 60_000 }
                )
                .then(() => undefined),
        waitForTerminal: () =>
            page
                .waitForFunction(
                    (stateKey) => {
                        const target = globalThis as unknown as Record<
                            string,
                            unknown
                        >;
                        const state = target[stateKey] as
                            { uiPaintedEpochMs: number | null } | undefined;
                        return typeof state?.uiPaintedEpochMs === 'number';
                    },
                    RENDERER_CAPTURE_STATE_KEY,
                    { timeout: 120_000 }
                )
                .then(() => undefined),
    });
}

function throwHeapSampleError(error: unknown): void {
    if (error instanceof Error) {
        throw error;
    }
    if (error !== null) {
        throw new Error(`Renderer heap sampling failed: ${String(error)}`);
    }
}

function requireArtifactPath(value: string | null, label: string): string {
    if (value === null) {
        throw new Error(`${label} path is unavailable`);
    }
    return value;
}

async function installRendererProbe(
    page: Page,
    sourceTitle: string
): Promise<void> {
    await page.evaluate(
        ({ heartbeatIntervalMs, sourceTitle: title, stateKey }) => {
            interface PlaylistRefreshEvent {
                readonly operationId: string;
                readonly phase?: string;
                readonly status: string;
            }
            interface ElectronApi {
                onPlaylistRefreshEvent(
                    callback: (event: PlaylistRefreshEvent) => void
                ): (() => void) | undefined;
            }
            interface ProbeState {
                cancelButtonFound: boolean;
                cancelClickEpochMs: number | null;
                events: {
                    operationId: string;
                    phase: string | null;
                    receivedEpochMs: number;
                    status: string;
                }[];
                frameGapsMs: number[];
                frameRequestId: number;
                heartbeatDelaysMs: number[];
                heartbeatTimer: number;
                lastFrameAt: number | null;
                lastHeartbeatAt: number;
                longTaskObserver: PerformanceObserver | null;
                longTasksMs: number[];
                mutationObserver: MutationObserver;
                operationId: string | null;
                operationStartEpochMs: number;
                terminalEpochMs: number | null;
                uiPaintFrameRequestId: number | null;
                uiPaintedEpochMs: number | null;
                uiPhaseEpochMs: Record<string, number>;
                uiSettledEpochMs: number | null;
                unsubscribe: () => void;
            }
            const target = globalThis as unknown as Record<string, unknown>;
            const epoch = (): number =>
                performance.timeOrigin + performance.now();
            const sourceRow = (): Element | undefined =>
                Array.from(document.querySelectorAll('app-playlist-item')).find(
                    (element) => element.textContent?.includes(title)
                );
            const state = {
                cancelButtonFound: false,
                cancelClickEpochMs: null,
                events: [],
                frameGapsMs: [],
                frameRequestId: 0,
                heartbeatDelaysMs: [],
                heartbeatTimer: 0,
                lastFrameAt: null,
                lastHeartbeatAt: performance.now(),
                longTaskObserver: null,
                longTasksMs: [],
                mutationObserver: null,
                operationId: null,
                operationStartEpochMs: 0,
                terminalEpochMs: null,
                uiPaintFrameRequestId: null,
                uiPaintedEpochMs: null,
                uiPhaseEpochMs: Object.create(null) as Record<string, number>,
                uiSettledEpochMs: null,
                unsubscribe: () => undefined,
            } as unknown as ProbeState;
            const inspectUi = (): void => {
                const row = sourceRow();
                const message =
                    row
                        ?.querySelector('.busy-state__message')
                        ?.textContent?.trim()
                        .toLowerCase() ?? '';
                for (const phase of ['fetch', 'pars', 'sav']) {
                    if (
                        message.includes(phase) &&
                        state.uiPhaseEpochMs[phase] === undefined
                    ) {
                        state.uiPhaseEpochMs[phase] = epoch();
                    }
                }
                if (
                    state.cancelClickEpochMs !== null &&
                    state.uiSettledEpochMs === null &&
                    row !== undefined &&
                    row.querySelector('.busy-state__message') === null &&
                    row.querySelector('.action-spinner') === null &&
                    row.querySelector('.cancel-btn') === null
                ) {
                    state.uiSettledEpochMs = epoch();
                    state.uiPaintFrameRequestId = requestAnimationFrame(() => {
                        state.uiPaintFrameRequestId = requestAnimationFrame(
                            () => {
                                state.uiPaintedEpochMs = epoch();
                                state.terminalEpochMs = state.uiPaintedEpochMs;
                                state.uiPaintFrameRequestId = null;
                            }
                        );
                    });
                }
            };
            const frame = (timestamp: number): void => {
                if (state.lastFrameAt !== null) {
                    state.frameGapsMs.push(timestamp - state.lastFrameAt);
                }
                state.lastFrameAt = timestamp;
                state.frameRequestId = requestAnimationFrame(frame);
            };
            state.frameRequestId = requestAnimationFrame(frame);
            state.heartbeatTimer = window.setInterval(() => {
                const now = performance.now();
                state.heartbeatDelaysMs.push(
                    Math.max(
                        0,
                        now - state.lastHeartbeatAt - heartbeatIntervalMs
                    )
                );
                state.lastHeartbeatAt = now;
            }, heartbeatIntervalMs);
            if (
                typeof PerformanceObserver === 'function' &&
                PerformanceObserver.supportedEntryTypes.includes('longtask')
            ) {
                state.longTaskObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        state.longTasksMs.push(entry.duration);
                    }
                });
                state.longTaskObserver.observe({ entryTypes: ['longtask'] });
            }
            state.mutationObserver = new MutationObserver(inspectUi);
            state.mutationObserver.observe(document.documentElement, {
                attributes: true,
                childList: true,
                subtree: true,
            });
            const electron = (
                globalThis as unknown as { electron?: ElectronApi }
            ).electron;
            if (!electron?.onPlaylistRefreshEvent) {
                throw new Error('Playlist refresh event bridge is unavailable');
            }
            const unsubscribe = electron.onPlaylistRefreshEvent((event) => {
                const receivedEpochMs = epoch();
                if (state.operationId === null && event.status === 'started') {
                    state.operationId = event.operationId;
                }
                if (state.operationId !== event.operationId) {
                    return;
                }
                state.events.push({
                    operationId: event.operationId,
                    phase: event.phase ?? null,
                    receivedEpochMs,
                    status: event.status,
                });
                if (
                    event.status === 'progress' &&
                    event.phase === 'parsing' &&
                    state.cancelClickEpochMs === null
                ) {
                    const button = sourceRow()?.querySelector('.cancel-btn');
                    state.cancelButtonFound =
                        button instanceof HTMLButtonElement;
                    if (button instanceof HTMLButtonElement) {
                        state.cancelClickEpochMs = epoch();
                        button.click();
                    }
                }
            });
            state.unsubscribe =
                typeof unsubscribe === 'function'
                    ? unsubscribe
                    : () => undefined;
            target[stateKey] = state;
            inspectUi();
        },
        {
            heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
            sourceTitle,
            stateKey: RENDERER_CAPTURE_STATE_KEY,
        }
    );
}

async function markRendererOperationStart(page: Page): Promise<number> {
    return page.evaluate((stateKey) => {
        const target = globalThis as unknown as Record<string, unknown>;
        const state = target[stateKey] as { operationStartEpochMs: number };
        state.operationStartEpochMs =
            performance.timeOrigin + performance.now();
        return state.operationStartEpochMs;
    }, RENDERER_CAPTURE_STATE_KEY);
}

async function stopRendererProbe(page: Page): Promise<RendererProbeMetrics> {
    return page.evaluate((stateKey) => {
        const target = globalThis as unknown as Record<string, unknown>;
        const state = target[stateKey] as {
            cancelButtonFound: boolean;
            cancelClickEpochMs: number | null;
            events: RendererProbeMetrics['events'];
            frameGapsMs: number[];
            frameRequestId: number;
            heartbeatDelaysMs: number[];
            heartbeatTimer: number;
            longTaskObserver: PerformanceObserver | null;
            longTasksMs: number[];
            mutationObserver: MutationObserver;
            operationStartEpochMs: number;
            terminalEpochMs: number | null;
            uiPaintFrameRequestId: number | null;
            uiPaintedEpochMs: number | null;
            uiPhaseEpochMs: Record<string, number>;
            uiSettledEpochMs: number | null;
            unsubscribe: () => void;
        };
        cancelAnimationFrame(state.frameRequestId);
        if (state.uiPaintFrameRequestId !== null) {
            cancelAnimationFrame(state.uiPaintFrameRequestId);
        }
        clearInterval(state.heartbeatTimer);
        for (const entry of state.longTaskObserver?.takeRecords() ?? []) {
            state.longTasksMs.push(entry.duration);
        }
        state.longTaskObserver?.disconnect();
        state.mutationObserver.disconnect();
        state.unsubscribe();
        const result: RendererProbeMetrics = {
            cancelButtonFound: state.cancelButtonFound,
            cancelClickEpochMs: state.cancelClickEpochMs,
            events: [...state.events],
            frameGapsMs: [...state.frameGapsMs],
            heartbeatDelaysMs: [...state.heartbeatDelaysMs],
            longTasksMs: [...state.longTasksMs],
            operationStartEpochMs: state.operationStartEpochMs,
            terminalEpochMs: state.terminalEpochMs,
            uiPaintedEpochMs: state.uiPaintedEpochMs,
            uiPhaseEpochMs: { ...state.uiPhaseEpochMs },
            uiSettledEpochMs: state.uiSettledEpochMs,
        };
        delete target[stateKey];
        return result;
    }, RENDERER_CAPTURE_STATE_KEY);
}
