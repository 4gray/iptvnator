/* eslint-disable max-lines -- The injected main-process protocol must remain self-contained for Playwright serialization. */
import type { ElectronApplication } from '@playwright/test';
import {
    M3U_IMPORT_PERFORMANCE_PHASE,
    M3U_IMPORT_PERFORMANCE_PHASE_EVENT_CHANNEL,
    XTREAM_MAIN_PERFORMANCE_PHASE,
    XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL,
    XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    XTREAM_PRELOAD_PERFORMANCE_METHOD,
    XTREAM_PRELOAD_PERFORMANCE_SCHEMA_VERSION,
    XtreamCodeActions,
} from '@iptvnator/shared/interfaces';

import {
    DATABASE_REQUEST_IDENTITY_CAPTURE_STATE_KEY,
    installDatabaseRequestIdentityCapture,
    type DatabaseRequestIdentity,
    type DatabaseRequestIdentityCaptureApi,
} from './database-request-identity-capture';
import {
    createDatabaseWorkerCancelCapture,
    type DatabaseWorkerCancelCapture,
    type DatabaseWorkerCancelCaptureSnapshot,
    type DatabaseWorkerCancelTimelineRecord,
} from './database-worker-cancel-capture';
import {
    createDatabaseWorkerPostGcCutoffApi,
    type DatabaseWorkerPostGcCutoffApi,
} from './database-worker-post-gc-cutoff';
import {
    createDatabaseWorkerPostGcFinalizationApi,
    type DatabaseWorkerPostGcAncillaryFailureStage,
    type DatabaseWorkerPostGcFinalizationApi,
} from './database-worker-post-gc-finalization';
import {
    createDatabaseWorkerPostGcProbeApi,
    type DatabaseWorkerPostGcProbeApi,
} from './database-worker-post-gc-probe';
import {
    createDatabaseWorkerPostGcSelectionApi,
    type DatabaseWorkerPostGcSelectionApi,
    type DatabaseWorkerPostGcUnavailableReason,
} from './database-worker-post-gc-selection';
import type {
    MainCaptureMetrics,
    WorkerCaptureMetrics,
    WorkerPostGcHeapUnavailableReason,
    WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';
import {
    selectMainCaptureGeneration,
    type MainCaptureGenerationTransport,
} from './worker-request-performance';
import {
    createWorkerTerminationGenerationApi,
    type WorkerTerminationGenerationApi,
} from './worker-termination-generation';
import {
    createRendererProcessRssCaptureApi,
    type RendererProcessRssCaptureApi,
} from './renderer-process-rss-capture';
import {
    createRendererWindowRssSessionApi,
    type RendererWindowIdentity,
    type RendererWindowRssSession,
    type RendererWindowRssSessionApi,
    type RendererWindowRssSessionMetrics,
} from './renderer-window-rss-session';
import { createDiagnosticsPerformancePhaseEventParser } from './performance-phase-events';
import {
    createPerformanceTimelineMergeApi,
    type PerformanceTimelineMergeApi,
} from './performance-timeline-merge';
import { createXtreamIpcMarkerCapture } from './xtream-ipc-marker-events';
import type {
    XtreamIpcMarkerCaptureSnapshot,
    XtreamIpcTimelineRecord,
} from './xtream-ipc-marker-events.model';
import { createXtreamIpcMarkerProtocol } from './xtream-ipc-marker-protocol';
import { createXtreamMainLifecycleValidator } from './xtream-main-lifecycle';

const MAIN_CAPTURE_STATE_KEY = '__iptvnatorM3uRefreshMainCapture';

export interface MainCaptureStartOptions {
    readonly deferMeasurement?: boolean;
    readonly diagnostic: boolean;
    readonly outputDirectory: string;
    readonly rendererWindowIdentity: RendererWindowIdentity;
}

export interface MainCaptureStatus {
    readonly databaseGetsCompleted: number;
    readonly databasePending: number;
    readonly databaseRequests: number;
    readonly databaseUpsertsCompleted: number;
    readonly playlistTerminated: number;
    readonly playlistResponsesFailed: number;
    readonly playlistResponses: number;
    readonly playlistResponsesSucceeded: number;
    readonly preloadSuccessMarkers: number;
}

export interface MainCaptureRolloverResult {
    readonly completedCapture: MainCaptureMetrics;
    readonly nextCaptureStarted: boolean;
    readonly nextCaptureUnavailableReason: string | null;
}

export type XtreamMainCaptureOperationOutcomeKind =
    'error' | 'pending' | 'success';

export interface XtreamMainCaptureOperationOutcome {
    readonly count: number;
    readonly operation: string;
    readonly outcome: XtreamMainCaptureOperationOutcomeKind;
}

export interface XtreamMainCaptureOperationProgress {
    readonly current: number | null;
    readonly epochMs: number;
    readonly phase: string | null;
    readonly status:
        'cancelled' | 'completed' | 'error' | 'progress' | 'started';
    readonly total: number | null;
}

export interface XtreamMainCaptureActiveOperation {
    readonly operation: string;
    readonly operationId: string | null;
    readonly playlistId: string | null;
    readonly progress: XtreamMainCaptureOperationProgress | null;
    readonly requestId: string;
}

export interface XtreamMainCaptureInvalidReasons {
    readonly capture: readonly string[];
    readonly databaseWorkerCancel: readonly string[];
    readonly xtreamIpc: readonly string[];
}

export interface XtreamMainCaptureStatus {
    readonly active: boolean;
    readonly activeOperations: readonly XtreamMainCaptureActiveOperation[];
    readonly captureGeneration: number;
    readonly captureStartedEpochMs: number;
    readonly cutoffPhase: 'active' | 'idle' | 'stopping';
    readonly databaseWorkerCount: number;
    readonly invalidReasons: readonly string[];
    readonly lateDatabaseRequestCount: number;
    readonly lateEventCount: number;
    readonly measurementPhase: 'armed' | 'frozen' | 'measuring';
    readonly measurementStartedEpochMs: number | null;
    readonly operationOutcomes: readonly XtreamMainCaptureOperationOutcome[];
    readonly playlistRefreshWorkerCount: number;
}

export interface MainCaptureRolloverStatus {
    readonly nextCaptureStarted: boolean;
    readonly nextCaptureUnavailableReason: string | null;
}

export interface XtreamMainCaptureTransport extends MainCaptureGenerationTransport {
    readonly rollover: MainCaptureRolloverStatus | null;
    readonly xtream: {
        readonly cancelCapture: DatabaseWorkerCancelCaptureSnapshot;
        readonly captureCutoffEpochMs: number;
        readonly captureGeneration: number;
        readonly captureStartedEpochMs: number;
        readonly captureStoppedEpochMs: number;
        readonly databaseWorkerCount: number;
        readonly invalidReasons: readonly string[];
        readonly ipcCapture: XtreamIpcMarkerCaptureSnapshot;
        readonly lateDatabaseRequestCount: number;
        readonly lateEventCount: number;
        readonly measurementStartedEpochMs: number;
        readonly operationOutcomes: readonly XtreamMainCaptureOperationOutcome[];
        readonly playlistRefreshWorkerCount: number;
    };
}

export interface XtreamMainCaptureResult {
    readonly cancelTimeline: readonly DatabaseWorkerCancelTimelineRecord[];
    readonly capture: MainCaptureMetrics;
    readonly captureCutoffEpochMs: number;
    readonly captureGeneration: number;
    readonly captureStartedEpochMs: number;
    readonly captureStoppedEpochMs: number;
    readonly databaseWorkerCount: number;
    readonly invalidReasons: XtreamMainCaptureInvalidReasons;
    readonly ipcTimeline: readonly XtreamIpcTimelineRecord[];
    readonly lateDatabaseRequestCount: number;
    readonly lateEventCount: number;
    readonly measurementStartedEpochMs: number;
    readonly operationOutcomes: readonly XtreamMainCaptureOperationOutcome[];
    readonly playlistRefreshWorkerCount: number;
    readonly quarantinedIpcMarkerCount: number;
    readonly requests: readonly WorkerRequestPerformanceMetrics[];
    readonly rollover: MainCaptureRolloverStatus | null;
    readonly workers: readonly WorkerCaptureMetrics[];
}

type MainCaptureStopTransport = XtreamMainCaptureTransport;

export async function installMainCapture(
    electronApp: ElectronApplication
): Promise<void> {
    await installDatabaseRequestIdentityCapture(electronApp);
    const captureStateKeys = {
        databaseRequestIdentityStateKey:
            DATABASE_REQUEST_IDENTITY_CAPTURE_STATE_KEY,
        databaseWorkerCancelCaptureFactorySource:
            createDatabaseWorkerCancelCapture.toString(),
        diagnosticsPerformancePhaseEventParserFactorySource:
            createDiagnosticsPerformancePhaseEventParser.toString(),
        databaseWorkerPostGcCutoffApiFactorySource:
            createDatabaseWorkerPostGcCutoffApi.toString(),
        databaseWorkerPostGcFinalizationApiFactorySource:
            createDatabaseWorkerPostGcFinalizationApi.toString(),
        databaseWorkerPostGcProbeApiFactorySource:
            createDatabaseWorkerPostGcProbeApi.toString(),
        databaseWorkerPostGcSelectionApiFactorySource:
            createDatabaseWorkerPostGcSelectionApi.toString(),
        rendererProcessRssApiFactorySource:
            createRendererProcessRssCaptureApi.toString(),
        rendererWindowRssSessionApiFactorySource:
            createRendererWindowRssSessionApi.toString(),
        m3uImportPerformancePhaseEventChannel:
            M3U_IMPORT_PERFORMANCE_PHASE_EVENT_CHANNEL,
        m3uImportPerformancePhases: Object.values(M3U_IMPORT_PERFORMANCE_PHASE),
        performanceTimelineMergeApiFactorySource:
            createPerformanceTimelineMergeApi.toString(),
        stateKey: MAIN_CAPTURE_STATE_KEY,
        workerTerminationGenerationApiFactorySource:
            createWorkerTerminationGenerationApi.toString(),
        xtreamIpcMarkerCaptureFactorySource:
            createXtreamIpcMarkerCapture.toString(),
        xtreamIpcMarkerCaptureOptions: {
            actions: Object.values(XtreamCodeActions),
            mainPhases: Object.values(XTREAM_MAIN_PERFORMANCE_PHASE),
            methods: Object.values(XTREAM_PRELOAD_PERFORMANCE_METHOD),
            schemaVersion: XTREAM_PRELOAD_PERFORMANCE_SCHEMA_VERSION,
        },
        xtreamIpcMarkerProtocolFactorySource:
            createXtreamIpcMarkerProtocol.toString(),
        xtreamMainPerformancePhaseEventChannel:
            XTREAM_MAIN_PERFORMANCE_PHASE_EVENT_CHANNEL,
        xtreamMainLifecycleValidatorFactorySource:
            createXtreamMainLifecycleValidator.toString(),
        xtreamPreloadPerformanceMarkerChannel:
            XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    };
    await electronApp.evaluate(async (electron, input) => {
        const { app, BrowserWindow, ipcMain } = electron;
        type JsonRecord = Record<string, unknown>;
        type WorkerTransferable = import('node:worker_threads').Transferable;
        interface CpuProfileHandle {
            stop(): Promise<unknown>;
        }
        interface WorkerHeapStatistics {
            external_memory?: number;
            used_heap_size?: number;
        }
        interface WorkerCpuUsage {
            system: number;
            user: number;
        }
        interface WorkerElu {
            active: number;
            idle: number;
            utilization: number;
        }
        interface WorkerRequestPerformance {
            identity: DatabaseRequestIdentity;
            operation: string | null;
            performanceCapture: unknown;
            playlistId: string | null;
            requestId: string | null;
            responseEpochMs: number;
            success: boolean;
        }
        interface InstrumentedWorker {
            cpuUsage?(): Promise<WorkerCpuUsage>;
            getHeapSnapshot?(): Promise<NodeJS.ReadableStream>;
            getHeapStatistics?(): Promise<WorkerHeapStatistics>;
            on(event: 'message', listener: (message: unknown) => void): this;
            performance?: {
                eventLoopUtilization(
                    utilization1?: WorkerElu,
                    utilization2?: WorkerElu
                ): WorkerElu;
            };
            postMessage(
                message: unknown,
                transferList?: readonly WorkerTransferable[]
            ): void;
            startCpuProfile?(): Promise<CpuProfileHandle>;
            terminate(): Promise<number>;
        }
        interface WorkerRecord {
            cancelPostedEpochMs: number | null;
            captureGeneration: number | null;
            cpuFirst: WorkerCpuUsage | null;
            cpuLast: WorkerCpuUsage | null;
            elu: number | null;
            eluStart: WorkerElu | null;
            externalMemorySampleCount: number;
            externalPeak: number;
            finalized: boolean;
            finalizationKey: object;
            finalizationTimedOut: boolean;
            finalizing: Promise<void> | null;
            heapPeak: number;
            heapUsedSampleCount: number;
            kind: 'database.worker' | 'playlist-refresh.worker';
            operationId: string | null;
            ordinal: number;
            pendingCount: number;
            playlistId: string | null;
            postGcHeapUnavailableReason: WorkerPostGcHeapUnavailableReason | null;
            postGcHeapUsed: number | null;
            profileHandle: Promise<CpuProfileHandle> | null;
            profileCaptureKey: object;
            profilePath: string | null;
            profileResult: unknown | null;
            resolvedProfileHandle: CpuProfileHandle | null;
            requestPerformance: WorkerRequestPerformance[];
            responseEpochMs: number | null;
            samplePromise: Promise<void> | null;
            samplingStarted: boolean;
            snapshotPath: string | null;
            terminatedEpochMs: number | null;
            worker: InstrumentedWorker;
        }
        interface TimelineRecord {
            readonly action?: string | null;
            readonly boundary?: 'end' | 'start';
            readonly byteCount?: number;
            readonly categoryType?: string | null;
            readonly contentType?: string | null;
            readonly durationMs?: number | null;
            readonly epochMs: number;
            readonly ipcCallId?: number;
            readonly itemCount?: number | null;
            readonly method?: string;
            readonly operation?: string;
            readonly operationId?: string | null;
            readonly outcome?: 'error' | 'success' | null;
            readonly phase?: string;
            readonly playlistId?: string | null;
            readonly requestId?: string;
            readonly sessionId?: string | null;
            readonly success?: boolean;
            readonly sourceEpochMs?: number;
            readonly type: string;
        }

        const target = globalThis as unknown as Record<string, unknown>;
        if (target[input.stateKey] !== undefined) {
            return;
        }
        const databaseRequestIdentityCapture = target[
            input.databaseRequestIdentityStateKey
        ] as DatabaseRequestIdentityCaptureApi;
        const restoreFunction = <T>(source: string): T =>
            new Function(`"use strict"; return (${source});`)() as T;
        const restoreFactory = <T>(source: string): T => {
            const factory = restoreFunction<() => T>(source);
            return factory();
        };
        const databaseWorkerPostGcCutoffApi =
            restoreFactory<DatabaseWorkerPostGcCutoffApi>(
                input.databaseWorkerPostGcCutoffApiFactorySource
            );
        const databaseWorkerCancelCapture =
            restoreFactory<DatabaseWorkerCancelCapture>(
                input.databaseWorkerCancelCaptureFactorySource
            );
        const databaseWorkerPostGcFinalizationApi =
            restoreFactory<DatabaseWorkerPostGcFinalizationApi>(
                input.databaseWorkerPostGcFinalizationApiFactorySource
            );
        const databaseWorkerPostGcProbeApi =
            restoreFactory<DatabaseWorkerPostGcProbeApi>(
                input.databaseWorkerPostGcProbeApiFactorySource
            );
        const databaseWorkerPostGcSelectionApi =
            restoreFactory<DatabaseWorkerPostGcSelectionApi>(
                input.databaseWorkerPostGcSelectionApiFactorySource
            );
        const rendererProcessRssApi =
            restoreFactory<RendererProcessRssCaptureApi>(
                input.rendererProcessRssApiFactorySource
            );
        const rendererWindowRssSessionApi =
            restoreFactory<RendererWindowRssSessionApi>(
                input.rendererWindowRssSessionApiFactorySource
            );
        const workerTerminationGenerationApi =
            restoreFactory<WorkerTerminationGenerationApi>(
                input.workerTerminationGenerationApiFactorySource
            );
        const diagnosticsPerformancePhaseEventParserFactory = restoreFunction<
            typeof createDiagnosticsPerformancePhaseEventParser
        >(input.diagnosticsPerformancePhaseEventParserFactorySource);
        const performanceTimelineMergeApi =
            restoreFactory<PerformanceTimelineMergeApi>(
                input.performanceTimelineMergeApiFactorySource
            );
        const xtreamIpcMarkerProtocolFactory = restoreFunction<
            typeof createXtreamIpcMarkerProtocol
        >(input.xtreamIpcMarkerProtocolFactorySource);
        const xtreamIpcMarkerCaptureFactory = restoreFunction<
            typeof createXtreamIpcMarkerCapture
        >(input.xtreamIpcMarkerCaptureFactorySource);
        const xtreamMainLifecycleValidatorFactory = restoreFunction<
            typeof createXtreamMainLifecycleValidator
        >(input.xtreamMainLifecycleValidatorFactorySource);
        const xtreamIpcMarkerCapture = xtreamIpcMarkerCaptureFactory(
            input.xtreamIpcMarkerCaptureOptions,
            xtreamIpcMarkerProtocolFactory(input.xtreamIpcMarkerCaptureOptions),
            xtreamMainLifecycleValidatorFactory()
        );

        const runtimeProcess = process as typeof process & {
            getBuiltinModule(id: string): unknown;
            threadCpuUsage(previousValue?: NodeJS.CpuUsage): NodeJS.CpuUsage;
        };
        const fs = runtimeProcess.getBuiltinModule(
            'node:fs'
        ) as typeof import('node:fs');
        const inspector = runtimeProcess.getBuiltinModule(
            'node:inspector'
        ) as typeof import('node:inspector');
        const diagnosticsChannel = runtimeProcess.getBuiltinModule(
            'node:diagnostics_channel'
        ) as typeof import('node:diagnostics_channel');
        const path = runtimeProcess.getBuiltinModule(
            'node:path'
        ) as typeof import('node:path');
        const perfHooks = runtimeProcess.getBuiltinModule(
            'node:perf_hooks'
        ) as typeof import('node:perf_hooks');
        const streamPromises = runtimeProcess.getBuiltinModule(
            'node:stream/promises'
        ) as typeof import('node:stream/promises');
        const workerThreads = runtimeProcess.getBuiltinModule(
            'node:worker_threads'
        ) as typeof import('node:worker_threads');
        const WorkerClass = workerThreads.Worker;
        const originalPostMessage = WorkerClass.prototype.postMessage;
        const originalTerminate = WorkerClass.prototype.terminate;
        const records = new Map<InstrumentedWorker, WorkerRecord>();
        let nextWorkerOrdinal = 1;
        const operationWorkers = new Map<string, WorkerRecord>();
        const dbRequests = new Map<
            string,
            {
                identity: DatabaseRequestIdentity;
                operation: string;
                playlistId: string | null;
                progress: XtreamMainCaptureOperationProgress | null;
                record: WorkerRecord;
            }
        >();

        const state = {
            active: false,
            captureGeneration: 0,
            captureInvalidReasons: [] as string[],
            captureOptions: null as MainCaptureStartOptions | null,
            captureStartedEpochMs: null as number | null,
            cpuStart: null as NodeJS.CpuUsage | null,
            diagnostic: false,
            eventLoopDelay: null as ReturnType<
                typeof perfHooks.monitorEventLoopDelay
            > | null,
            eventLoopStart: null as ReturnType<
                typeof perfHooks.performance.eventLoopUtilization
            > | null,
            inspectorSession: null as import('node:inspector').Session | null,
            mainPeakHeap: 0,
            mainPeakRss: 0,
            mainProfilePath: null as string | null,
            mainSnapshotPath: null as string | null,
            measurementPhase: 'armed' as 'armed' | 'frozen' | 'measuring',
            measurementStartedEpochMs: null as number | null,
            outputDirectory: '',
            postGcHeap: null as number | null,
            postGcRss: null as number | null,
            rendererWindowSession: null as RendererWindowRssSession | null,
            lateEventCount: 0,
            sampleTimer: null as NodeJS.Timeout | null,
            stopping: false,
            timeline: [] as TimelineRecord[],
        };

        const nowEpochMs = (): number =>
            perfHooks.performance.timeOrigin + perfHooks.performance.now();
        const recordTimeline = (
            record: Omit<TimelineRecord, 'epochMs'>
        ): void => {
            if (state.active || state.stopping) {
                state.timeline.push({ epochMs: nowEpochMs(), ...record });
            }
        };
        const invalidateCapture = (reason: string): void => {
            if (!state.captureInvalidReasons.includes(reason)) {
                state.captureInvalidReasons.push(reason);
            }
        };
        const readDatabaseProgress = (
            inputValue: unknown
        ): XtreamMainCaptureOperationProgress | null => {
            if (typeof inputValue !== 'object' || inputValue === null) {
                invalidateCapture('database-operation-progress-invalid');
                return null;
            }
            const event = inputValue as JsonRecord;
            const status = event['status'];
            const phase = event['phase'];
            const current = event['current'];
            const total = event['total'];
            if (
                typeof event['operation'] !== 'string' ||
                !/^[a-z][a-z0-9-]{0,127}$/.test(event['operation']) ||
                ![
                    'cancelled',
                    'completed',
                    'error',
                    'progress',
                    'started',
                ].includes(String(status)) ||
                !(
                    phase === undefined ||
                    phase === null ||
                    (typeof phase === 'string' &&
                        /^[a-z][a-z0-9-]{0,127}$/.test(phase))
                ) ||
                !(
                    current === undefined ||
                    (typeof current === 'number' &&
                        Number.isFinite(current) &&
                        current >= 0)
                ) ||
                !(
                    total === undefined ||
                    (typeof total === 'number' &&
                        Number.isFinite(total) &&
                        total >= 0)
                )
            ) {
                invalidateCapture('database-operation-progress-invalid');
                return null;
            }
            return {
                current: typeof current === 'number' ? current : null,
                epochMs: nowEpochMs(),
                phase: typeof phase === 'string' ? phase : null,
                status: status as XtreamMainCaptureOperationProgress['status'],
                total: typeof total === 'number' ? total : null,
            };
        };
        const readOperationOutcomes =
            (): XtreamMainCaptureOperationOutcome[] => {
                const counts = new Map<
                    string,
                    { error: number; requests: number; success: number }
                >();
                for (const entry of state.timeline) {
                    if (
                        entry.type !== 'db-request' &&
                        entry.type !== 'db-response'
                    ) {
                        continue;
                    }
                    if (
                        typeof entry.operation !== 'string' ||
                        !/^DB_[A-Z0-9_]{1,124}$/.test(entry.operation)
                    ) {
                        invalidateCapture('database-operation-outcome-invalid');
                        continue;
                    }
                    const count = counts.get(entry.operation) ?? {
                        error: 0,
                        requests: 0,
                        success: 0,
                    };
                    if (entry.type === 'db-request') {
                        count.requests += 1;
                    } else if (entry.success === true) {
                        count.success += 1;
                    } else if (entry.success === false) {
                        count.error += 1;
                    } else {
                        invalidateCapture('database-operation-outcome-invalid');
                    }
                    counts.set(entry.operation, count);
                }
                const outcomes: XtreamMainCaptureOperationOutcome[] = [];
                for (const operation of [...counts.keys()].sort()) {
                    const count = counts.get(operation);
                    if (!count) continue;
                    const pending =
                        count.requests - count.error - count.success;
                    if (pending < 0) {
                        invalidateCapture('database-operation-outcome-invalid');
                    }
                    for (const [outcome, value] of [
                        ['error', count.error],
                        ['pending', Math.max(0, pending)],
                        ['success', count.success],
                    ] as const) {
                        if (value > 0) {
                            outcomes.push({ count: value, operation, outcome });
                        }
                    }
                }
                return outcomes;
            };
        const parseM3uImportPhase =
            diagnosticsPerformancePhaseEventParserFactory({
                allowedPhases: input.m3uImportPerformancePhases,
                timelineType: 'm3u-import-phase',
            });
        const parseXtreamMainPhase =
            diagnosticsPerformancePhaseEventParserFactory({
                allowedPhases: input.xtreamIpcMarkerCaptureOptions.mainPhases,
                timelineType: 'xtream-main-phase',
            });
        const subscribeDiagnosticsPhase = (
            channelName: string,
            parse: ReturnType<
                typeof createDiagnosticsPerformancePhaseEventParser
            >,
            accept: (event: NonNullable<ReturnType<typeof parse>>) => void
        ): void => {
            diagnosticsChannel.channel(channelName).subscribe((incoming) => {
                if (!state.active && !state.stopping) {
                    return;
                }
                const event = parse(incoming);
                if (event) {
                    accept(event);
                }
            });
        };
        subscribeDiagnosticsPhase(
            input.m3uImportPerformancePhaseEventChannel,
            parseM3uImportPhase,
            (event) => state.timeline.push(event)
        );
        subscribeDiagnosticsPhase(
            input.xtreamMainPerformancePhaseEventChannel,
            parseXtreamMainPhase,
            (event) => {
                xtreamIpcMarkerCapture.acceptMainPhase(event);
            }
        );
        ipcMain.on(
            input.xtreamPreloadPerformanceMarkerChannel,
            (event, marker) => {
                let senderWebContentsId = -1;
                try {
                    senderWebContentsId = event.sender.id;
                } catch {
                    // Strict capture rejects an unreadable sender identity.
                }
                xtreamIpcMarkerCapture.acceptPreload(
                    senderWebContentsId,
                    nowEpochMs(),
                    marker
                );
            }
        );
        const classifyRequest = (
            message: JsonRecord
        ): 'database.worker' | 'playlist-refresh.worker' | null => {
            if (typeof message['operation'] === 'string') {
                return 'database.worker';
            }
            const payload = message['payload'];
            return typeof payload === 'object' &&
                payload !== null &&
                typeof (payload as JsonRecord)['operationId'] === 'string' &&
                typeof (payload as JsonRecord)['playlistId'] === 'string'
                ? 'playlist-refresh.worker'
                : null;
        };
        const readDatabasePlaylistId = (message: JsonRecord): string | null => {
            const payload = message['payload'];
            if (typeof payload !== 'object' || payload === null) {
                return null;
            }
            const value = payload as JsonRecord;
            const playlistId = value['playlistId'] ?? value['_id'];
            return typeof playlistId === 'string' ? playlistId : null;
        };
        const isCurrentCaptureRecord = (record: WorkerRecord): boolean =>
            state.active &&
            record.captureGeneration === state.captureGeneration;
        const createWorkerRecord = (
            worker: InstrumentedWorker,
            kind: WorkerRecord['kind']
        ): WorkerRecord => {
            const existing = records.get(worker);
            if (existing) {
                return existing;
            }
            const record: WorkerRecord = {
                cancelPostedEpochMs: null,
                captureGeneration: null,
                cpuFirst: null,
                cpuLast: null,
                elu: null,
                eluStart: null,
                externalMemorySampleCount: 0,
                externalPeak: 0,
                finalized: false,
                finalizationKey: {},
                finalizationTimedOut: false,
                finalizing: null,
                heapPeak: 0,
                heapUsedSampleCount: 0,
                kind,
                operationId: null,
                ordinal: nextWorkerOrdinal,
                pendingCount: 0,
                playlistId: null,
                postGcHeapUnavailableReason: 'post-gc-probe-not-run',
                postGcHeapUsed: null,
                profileHandle: null,
                profileCaptureKey: {},
                profilePath: null,
                profileResult: null,
                resolvedProfileHandle: null,
                requestPerformance: [],
                responseEpochMs: null,
                samplePromise: null,
                samplingStarted: false,
                snapshotPath: null,
                terminatedEpochMs: null,
                worker,
            };
            nextWorkerOrdinal += 1;
            records.set(worker, record);
            worker.on('message', (incoming) => {
                if (typeof incoming !== 'object' || incoming === null) {
                    return;
                }
                const message = incoming as JsonRecord;
                if (message['type'] === 'performance-cancel-received') {
                    if (record.kind === 'database.worker') {
                        databaseWorkerCancelCapture.acceptReceipt({
                            captureGeneration: state.captureGeneration,
                            message,
                            receivedEpochMs: nowEpochMs(),
                            recordGeneration: record.captureGeneration,
                        });
                    }
                    return;
                }
                if (!isCurrentCaptureRecord(record)) {
                    return;
                }
                if (record.kind === 'playlist-refresh.worker') {
                    if (message['type'] === 'event') {
                        const event = message['event'] as
                            JsonRecord | undefined;
                        recordTimeline({
                            operationId: record.operationId ?? undefined,
                            playlistId: record.playlistId ?? undefined,
                            type: `playlist-event:${String(
                                event?.['status'] ?? 'unknown'
                            )}:${String(event?.['phase'] ?? 'none')}`,
                        });
                    } else if (message['type'] === 'response') {
                        const responseEpochMs = nowEpochMs();
                        record.responseEpochMs = responseEpochMs;
                        record.requestPerformance.push({
                            identity: {
                                ipcCallId: null,
                                operationId: record.operationId,
                                operationIdUnavailableReason: null,
                                sourceEpochMs: null,
                            },
                            operation: null,
                            performanceCapture: message['performance'] ?? null,
                            playlistId: record.playlistId,
                            requestId: null,
                            responseEpochMs,
                            success: message['success'] === true,
                        });
                        recordTimeline({
                            operationId: record.operationId ?? undefined,
                            playlistId: record.playlistId ?? undefined,
                            success: message['success'] === true,
                            type: 'playlist-response',
                        });
                    }
                    return;
                }
                if (
                    message['type'] === 'event' &&
                    typeof message['requestId'] === 'string'
                ) {
                    const event = message['event'];
                    const request = dbRequests.get(message['requestId']);
                    if (request) {
                        request.progress = readDatabaseProgress(event);
                    }
                    if (
                        request &&
                        typeof event === 'object' &&
                        event !== null &&
                        (event as JsonRecord)['status'] === 'cancelled' &&
                        typeof (event as JsonRecord)['operationId'] === 'string'
                    ) {
                        databaseWorkerCancelCapture.acceptTerminal({
                            captureGeneration: state.captureGeneration,
                            operationId: (event as JsonRecord)[
                                'operationId'
                            ] as string,
                            receivedEpochMs: nowEpochMs(),
                            recordGeneration: record.captureGeneration,
                            requestId: message['requestId'],
                        });
                    }
                    return;
                }
                if (
                    message['type'] === 'response' &&
                    typeof message['requestId'] === 'string'
                ) {
                    const request = dbRequests.get(message['requestId']);
                    if (request) {
                        request.record.pendingCount = Math.max(
                            0,
                            request.record.pendingCount - 1
                        );
                        record.requestPerformance.push({
                            identity: request.identity,
                            operation: request.operation,
                            performanceCapture: message['performance'] ?? null,
                            playlistId: request.playlistId,
                            requestId: message['requestId'],
                            responseEpochMs: nowEpochMs(),
                            success: message['success'] === true,
                        });
                    }
                    if (request) {
                        dbRequests.delete(message['requestId']);
                        recordTimeline({
                            operation: request.operation,
                            operationId:
                                request.identity.operationId ?? undefined,
                            playlistId: request.playlistId ?? undefined,
                            requestId: message['requestId'],
                            success: message['success'] === true,
                            type: 'db-response',
                        });
                    }
                }
            });
            return record;
        };
        const sampleWorker = (record: WorkerRecord): Promise<void> => {
            if (record.finalized) {
                return Promise.resolve();
            }
            if (record.samplePromise) {
                return record.samplePromise;
            }
            record.samplePromise = (async () => {
                try {
                    const stats = await record.worker.getHeapStatistics?.();
                    if (stats) {
                        const heapUsedSample = stats.used_heap_size;
                        if (
                            typeof heapUsedSample === 'number' &&
                            Number.isFinite(heapUsedSample) &&
                            heapUsedSample >= 0
                        ) {
                            record.heapUsedSampleCount += 1;
                            record.heapPeak = Math.max(
                                record.heapPeak,
                                heapUsedSample
                            );
                        }
                        const externalMemorySample = stats.external_memory;
                        if (
                            typeof externalMemorySample === 'number' &&
                            Number.isFinite(externalMemorySample) &&
                            externalMemorySample >= 0
                        ) {
                            record.externalMemorySampleCount += 1;
                            record.externalPeak = Math.max(
                                record.externalPeak,
                                externalMemorySample
                            );
                        }
                    }
                    const cpu = await record.worker.cpuUsage?.();
                    if (cpu) {
                        record.cpuFirst ??= cpu;
                        record.cpuLast = cpu;
                    }
                    const elu = record.worker.performance?.eventLoopUtilization(
                        record.eluStart ?? undefined
                    );
                    if (elu) {
                        record.elu = elu.utilization;
                    }
                } catch {
                    // A one-shot worker may terminate between sampling calls.
                }
            })().finally(() => {
                record.samplePromise = null;
            });
            return record.samplePromise;
        };
        const resetWorkerForCapture = (record: WorkerRecord): void => {
            record.cancelPostedEpochMs = null;
            record.captureGeneration = state.captureGeneration;
            record.cpuFirst = null;
            record.cpuLast = null;
            record.elu = null;
            record.eluStart = null;
            record.externalMemorySampleCount = 0;
            record.externalPeak = 0;
            record.finalized = false;
            record.finalizationKey = {};
            record.finalizationTimedOut = false;
            record.finalizing = null;
            record.heapPeak = 0;
            record.heapUsedSampleCount = 0;
            record.operationId = null;
            record.pendingCount = 0;
            record.playlistId = null;
            record.postGcHeapUnavailableReason = 'post-gc-probe-not-run';
            record.postGcHeapUsed = null;
            record.profileHandle = null;
            record.profileCaptureKey = {};
            record.profilePath = null;
            record.profileResult = null;
            record.resolvedProfileHandle = null;
            record.requestPerformance = [];
            record.responseEpochMs = null;
            record.samplePromise = null;
            record.samplingStarted = false;
            record.snapshotPath = null;
            record.terminatedEpochMs = null;
        };
        const startWorker = async (record: WorkerRecord): Promise<void> => {
            if (!state.active || state.measurementPhase !== 'measuring') {
                return;
            }
            if (record.captureGeneration !== state.captureGeneration) {
                resetWorkerForCapture(record);
            }
            if (record.samplingStarted) {
                return;
            }
            record.samplingStarted = true;
            record.elu = null;
            record.eluStart =
                record.worker.performance?.eventLoopUtilization() ?? null;
            const initialSample = sampleWorker(record);
            let profileReady: Promise<unknown> = Promise.resolve();
            if (
                state.diagnostic &&
                typeof record.worker.startCpuProfile === 'function'
            ) {
                record.profilePath = path.join(
                    state.outputDirectory,
                    `${record.kind}-${record.ordinal}.cpuprofile`
                );
                const profileHandle = record.worker.startCpuProfile();
                const profileCaptureKey = record.profileCaptureKey;
                record.profileHandle = profileHandle;
                profileReady = profileHandle.then(
                    (handle) => {
                        if (
                            record.profileCaptureKey === profileCaptureKey &&
                            record.profileHandle === profileHandle
                        ) {
                            record.resolvedProfileHandle = handle;
                        }
                    },
                    (error: unknown) => {
                        throw error;
                    }
                );
            }
            await Promise.all([initialSample, profileReady]);
        };
        const stopWorkerSampling = (record: WorkerRecord): void => {
            record.samplingStarted = false;
        };
        const joinFinalWorkerSample = async (
            record: WorkerRecord
        ): Promise<void> => {
            if (record.samplePromise) {
                await record.samplePromise;
            }
            await sampleWorker(record);
        };
        const stopWorkerProfile = async (
            record: WorkerRecord,
            waitForHandle = true
        ): Promise<void> => {
            const profileCaptureKey = record.profileCaptureKey;
            const profileHandle = record.profileHandle;
            if (!profileHandle || !record.profilePath) {
                return;
            }
            if (record.profileResult !== null) {
                return;
            }
            const handle =
                record.resolvedProfileHandle ??
                (waitForHandle ? await profileHandle : null);
            if (!handle) {
                throw new Error(
                    'cpu-profile-handle-not-ready-before-worker-termination'
                );
            }
            const profileResult = await handle.stop();
            if (
                record.profileCaptureKey !== profileCaptureKey ||
                record.finalizationTimedOut
            ) {
                return;
            }
            record.profileResult = profileResult;
        };
        const writeWorkerProfile = (record: WorkerRecord): void => {
            if (!record.profileHandle || !record.profilePath) {
                return;
            }
            if (record.profileResult === null) {
                throw new Error('worker-cpu-profile-result-missing');
            }
            fs.writeFileSync(
                record.profilePath,
                JSON.stringify(normalizeWorkerCpuProfile(record.profileResult)),
                { encoding: 'utf8', flag: 'wx', mode: 0o600 }
            );
            record.profileHandle = null;
            record.profileResult = null;
            record.resolvedProfileHandle = null;
        };
        const flushWorkerProfiles = (workerRecords: WorkerRecord[]): void => {
            for (const record of workerRecords) {
                try {
                    writeWorkerProfile(record);
                } catch (error: unknown) {
                    reportWorkerArtifactFailure(record, 'profile-write', error);
                }
            }
        };
        const takeWorkerHeapSnapshot = async (
            record: WorkerRecord
        ): Promise<void> => {
            if (typeof record.worker.getHeapSnapshot !== 'function') {
                return;
            }
            record.snapshotPath = path.join(
                state.outputDirectory,
                `${record.kind}-${record.ordinal}.heapsnapshot`
            );
            const snapshot = await record.worker.getHeapSnapshot();
            await streamPromises.pipeline(
                snapshot,
                fs.createWriteStream(record.snapshotPath, {
                    flags: 'wx',
                    mode: 0o600,
                })
            );
        };
        const reportWorkerArtifactFailure = (
            record: WorkerRecord,
            stage: DatabaseWorkerPostGcAncillaryFailureStage,
            error: unknown
        ): void => {
            if (stage === 'heap-snapshot') {
                record.snapshotPath = null;
            } else if (stage === 'profile-stop' || stage === 'profile-write') {
                record.profilePath = null;
                record.profileResult = null;
                record.profileHandle = null;
                record.resolvedProfileHandle = null;
            }
            recordTimeline({
                type: `worker-artifact-error:${stage}:${
                    error instanceof Error
                        ? error.message.slice(0, 160)
                        : String(error).slice(0, 160)
                }`,
            });
        };
        const finalizeDatabaseWorker = (
            record: WorkerRecord,
            selectionUnavailableReason: DatabaseWorkerPostGcUnavailableReason | null
        ): Promise<void> => {
            record.finalizing ??= databaseWorkerPostGcFinalizationApi
                .finalize({
                    finalizationKey: record.finalizationKey,
                    joinFinalSample: () => Promise.resolve(),
                    probePostGc: () =>
                        selectionUnavailableReason === null
                            ? databaseWorkerPostGcProbeApi.probe({
                                  createMessageChannel: () =>
                                      new workerThreads.MessageChannel(),
                                  worker: {
                                      postMessage(
                                          message: unknown,
                                          transferList: readonly unknown[]
                                      ): void {
                                          record.worker.postMessage(
                                              message,
                                              transferList as readonly WorkerTransferable[]
                                          );
                                      },
                                  },
                              })
                            : Promise.resolve({
                                  postGcHeapUsedBytes: null,
                                  unavailableReason: selectionUnavailableReason,
                              }),
                    reportAncillaryFailure: (stage, error) =>
                        reportWorkerArtifactFailure(record, stage, error),
                    stopProfile: () => Promise.resolve(),
                    stopSampling: () => stopWorkerSampling(record),
                    ...(state.diagnostic
                        ? {
                              takeHeapSnapshot: () =>
                                  takeWorkerHeapSnapshot(record),
                          }
                        : {}),
                })
                .then((outcome) => {
                    record.postGcHeapUsed = outcome.postGcHeapUsedBytes;
                    record.postGcHeapUnavailableReason =
                        outcome.unavailableReason;
                    record.finalized = true;
                })
                .catch((error: unknown) => {
                    record.postGcHeapUsed = null;
                    record.postGcHeapUnavailableReason = 'capture-failed';
                    reportWorkerArtifactFailure(record, 'post-gc-probe', error);
                    record.finalized = true;
                });
            return record.finalizing;
        };
        const finalizeTerminatingWorker = (
            record: WorkerRecord,
            waitForProfileHandle: boolean
        ): Promise<void> => {
            if (record.finalizing) {
                return record.finalizing;
            }
            const finalizationKey = record.finalizationKey;
            record.finalizing = (async () => {
                stopWorkerSampling(record);
                record.postGcHeapUsed = null;
                record.postGcHeapUnavailableReason =
                    'worker-force-terminated-before-gc';
                try {
                    await stopWorkerProfile(record, waitForProfileHandle);
                } catch (error: unknown) {
                    if (
                        record.finalizationKey === finalizationKey &&
                        !record.finalizationTimedOut
                    ) {
                        reportWorkerArtifactFailure(
                            record,
                            'profile-stop',
                            error
                        );
                    }
                }
                if (record.finalizationKey === finalizationKey) {
                    record.finalized = true;
                }
            })();
            return record.finalizing;
        };
        const waitForTerminatingWorkerFinalization = async (
            record: WorkerRecord
        ): Promise<void> => {
            if (!record.finalizing || record.finalizationTimedOut) {
                return;
            }
            let timeout: NodeJS.Timeout | null = null;
            let timedOut = false;
            await Promise.race([
                record.finalizing,
                new Promise<void>((resolve) => {
                    timeout = setTimeout(() => {
                        timedOut = true;
                        resolve();
                    }, 5_000);
                }),
            ]);
            if (timeout) {
                clearTimeout(timeout);
            }
            if (timedOut) {
                record.finalizationTimedOut = true;
                record.profileCaptureKey = {};
                reportWorkerArtifactFailure(
                    record,
                    'profile-stop',
                    new Error('worker-profile-finalization-timeout')
                );
            }
        };

        WorkerClass.prototype.postMessage = function (
            this: InstrumentedWorker,
            message: unknown,
            transferList?: readonly WorkerTransferable[]
        ): void {
            if (typeof message === 'object' && message !== null) {
                const value = message as JsonRecord;
                if (value['type'] === 'request') {
                    const kind = classifyRequest(value);
                    if (kind) {
                        const requestDisposition =
                            kind === 'database.worker'
                                ? databaseWorkerPostGcCutoffApi.observeDatabaseRequest()
                                : null;
                        if (requestDisposition === 'after-cutoff') {
                            state.lateEventCount += 1;
                            state.timeline.push({
                                epochMs: nowEpochMs(),
                                operation:
                                    typeof value['operation'] === 'string'
                                        ? value['operation']
                                        : undefined,
                                playlistId:
                                    readDatabasePlaylistId(value) ?? undefined,
                                requestId:
                                    typeof value['requestId'] === 'string'
                                        ? value['requestId']
                                        : undefined,
                                type: 'db-request-after-capture-cutoff',
                            });
                            originalPostMessage.call(
                                this,
                                message,
                                transferList
                            );
                            return;
                        }
                        const record = createWorkerRecord(this, kind);
                        if (
                            state.active &&
                            state.measurementPhase !== 'measuring'
                        ) {
                            invalidateCapture(
                                'worker-request-before-measurement'
                            );
                        }
                        if (
                            state.active &&
                            state.measurementPhase === 'measuring' &&
                            kind === 'database.worker' &&
                            (!isCurrentCaptureRecord(record) ||
                                !record.samplingStarted)
                        ) {
                            invalidateCapture('database-worker-not-prearmed');
                        }
                        void startWorker(record).catch(() =>
                            invalidateCapture('worker-measurement-start-failed')
                        );
                        if (
                            isCurrentCaptureRecord(record) &&
                            kind === 'playlist-refresh.worker'
                        ) {
                            const payload = value['payload'] as JsonRecord;
                            record.operationId = String(payload['operationId']);
                            record.playlistId = String(payload['playlistId']);
                            operationWorkers.set(record.operationId, record);
                            recordTimeline({
                                operationId: record.operationId,
                                playlistId: record.playlistId,
                                type: 'playlist-request',
                            });
                        } else if (
                            isCurrentCaptureRecord(record) &&
                            typeof value['requestId'] === 'string' &&
                            typeof value['operation'] === 'string'
                        ) {
                            const payload = value['payload'];
                            const payloadOperationId =
                                typeof payload === 'object' &&
                                payload !== null &&
                                typeof (payload as JsonRecord)[
                                    'operationId'
                                ] === 'string' &&
                                String((payload as JsonRecord)['operationId'])
                                    .length > 0
                                    ? String(
                                          (payload as JsonRecord)['operationId']
                                      )
                                    : null;
                            const xtreamIdentity =
                                xtreamIpcMarkerCapture.matchDatabaseRequest(
                                    value
                                );
                            const identity =
                                xtreamIdentity ??
                                (payloadOperationId === null
                                    ? databaseRequestIdentityCapture.matchDatabaseRequest(
                                          value
                                      )
                                    : {
                                          ipcCallId: null,
                                          operationId: payloadOperationId,
                                          operationIdUnavailableReason: null,
                                          sourceEpochMs: null,
                                      });
                            record.pendingCount += 1;
                            dbRequests.set(value['requestId'], {
                                identity,
                                operation: value['operation'],
                                playlistId: readDatabasePlaylistId(value),
                                progress: null,
                                record,
                            });
                            recordTimeline({
                                ipcCallId: identity.ipcCallId ?? undefined,
                                operation: value['operation'],
                                operationId: identity.operationId ?? undefined,
                                playlistId:
                                    readDatabasePlaylistId(value) ?? undefined,
                                requestId: value['requestId'],
                                sourceEpochMs:
                                    identity.sourceEpochMs ?? undefined,
                                type: 'db-request',
                            });
                        }
                    }
                } else if (
                    value['type'] === 'cancel' &&
                    typeof value['operationId'] === 'string'
                ) {
                    const playlistRecord = operationWorkers.get(
                        value['operationId']
                    );
                    const cancelPostedEpochMs = nowEpochMs();
                    if (playlistRecord) {
                        playlistRecord.cancelPostedEpochMs =
                            cancelPostedEpochMs;
                        recordTimeline({
                            operationId: value['operationId'],
                            type: 'playlist-cancel-posted',
                        });
                    } else {
                        const cancelIdentity =
                            xtreamIpcMarkerCapture.matchDatabaseCancel(value);
                        const matchingRequests = [
                            ...dbRequests.entries(),
                        ].filter(
                            ([, request]) =>
                                request.identity.operationId ===
                                value['operationId']
                        );
                        const match = matchingRequests[0];
                        if (
                            matchingRequests.length === 1 &&
                            match &&
                            cancelIdentity
                        ) {
                            const [requestId, request] = match;
                            request.record.cancelPostedEpochMs =
                                cancelPostedEpochMs;
                            databaseWorkerCancelCapture.acceptDispatch({
                                captureGeneration: state.captureGeneration,
                                ipcCallId: cancelIdentity.ipcCallId,
                                operationId: cancelIdentity.operationId,
                                postedEpochMs: cancelPostedEpochMs,
                                requestId,
                                sourceEpochMs: cancelIdentity.sourceEpochMs,
                            });
                        } else {
                            recordTimeline({
                                operationId: value['operationId'],
                                type: 'db-cancel-dispatch-correlation-invalid',
                            });
                        }
                    }
                }
            }
            originalPostMessage.call(this, message, transferList);
        };
        WorkerClass.prototype.terminate = function (
            this: InstrumentedWorker
        ): Promise<number> {
            const record = records.get(this);
            if (!record || !isCurrentCaptureRecord(record)) {
                return originalTerminate.call(this);
            }
            const terminationGeneration = record.captureGeneration;
            const markTerminated = (code: number): number => {
                if (
                    !workerTerminationGenerationApi.isCurrent({
                        capturedGeneration: terminationGeneration,
                        currentGeneration: state.captureGeneration,
                        recordGeneration: record.captureGeneration,
                    })
                ) {
                    return code;
                }
                record.terminatedEpochMs = nowEpochMs();
                record.finalized = true;
                recordTimeline({
                    operationId: record.operationId ?? undefined,
                    playlistId: record.playlistId ?? undefined,
                    type: `${record.kind}-terminated`,
                });
                return code;
            };
            if (state.diagnostic) {
                const diagnosticTermination = (async (): Promise<number> => {
                    void finalizeTerminatingWorker(record, true);
                    await waitForTerminatingWorkerFinalization(record);
                    return originalTerminate.call(this);
                })();
                return diagnosticTermination.then(markTerminated);
            }
            const termination = originalTerminate.call(this);
            void finalizeTerminatingWorker(record, false);
            return termination.then(markTerminated);
        };

        const inspectorPost = (
            session: import('node:inspector').Session,
            method: string,
            params: JsonRecord = {}
        ): Promise<JsonRecord> =>
            new Promise((resolve, reject) => {
                session.post(method, params, (error, result) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve((result ?? {}) as JsonRecord);
                    }
                });
            });
        const normalizeWorkerCpuProfile = (profile: unknown): unknown => {
            if (typeof profile !== 'string') {
                return profile;
            }
            try {
                return JSON.parse(profile) as unknown;
            } catch {
                // Node 24's Worker CPU profiler can leave quotes inside
                // RegExp pseudo-frame names unescaped. Repair only those
                // generated frame names, then require the full JSON to parse.
                const fieldPrefix = '"functionName":"RegExp: ';
                const fieldSuffix = '","lineNumber":';
                const valuePrefixLength = '"functionName":"'.length;
                let cursor = 0;
                let repaired = '';
                while (true) {
                    const fieldStart = profile.indexOf(fieldPrefix, cursor);
                    if (fieldStart < 0) {
                        repaired += profile.slice(cursor);
                        break;
                    }
                    const valueStart = fieldStart + valuePrefixLength;
                    const valueEnd = profile.indexOf(fieldSuffix, valueStart);
                    if (valueEnd < 0) {
                        throw new Error(
                            'Worker CPU profile has an unterminated RegExp frame'
                        );
                    }
                    repaired +=
                        profile.slice(cursor, fieldStart) +
                        '"functionName":' +
                        JSON.stringify(profile.slice(valueStart, valueEnd));
                    cursor = valueEnd + 1;
                }
                return JSON.parse(repaired) as unknown;
            }
        };
        const sampleMain = (): void => {
            const memory = process.memoryUsage();
            state.mainPeakHeap = Math.max(state.mainPeakHeap, memory.heapUsed);
            state.mainPeakRss = Math.max(state.mainPeakRss, memory.rss);
            state.rendererWindowSession?.sample();
            for (const record of records.values()) {
                if (record.samplingStarted && isCurrentCaptureRecord(record)) {
                    void sampleWorker(record);
                }
            }
        };
        const beginMeasurement = async (): Promise<number> => {
            if (
                !state.active ||
                state.stopping ||
                state.measurementPhase !== 'armed' ||
                state.measurementStartedEpochMs !== null ||
                state.captureOptions === null
            ) {
                throw new Error('xtream-main-measurement-boundary-unavailable');
            }
            const options = state.captureOptions;
            const databaseRecords = [...records.values()].filter(
                (record) => record.kind === 'database.worker'
            );
            if (options.deferMeasurement && databaseRecords.length !== 1) {
                throw new Error('xtream-database-worker-boundary-unavailable');
            }
            state.rendererWindowSession = rendererWindowRssSessionApi.create({
                browserWindowFromId: (browserWindowId) =>
                    BrowserWindow.fromId(browserWindowId),
                browserWindowId: options.rendererWindowIdentity.browserWindowId,
                getAppMetrics: () => app.getAppMetrics(),
                rendererRssApi: rendererProcessRssApi,
                webContentsId: options.rendererWindowIdentity.webContentsId,
            });
            if (state.diagnostic) {
                const session = new inspector.Session();
                session.connect();
                state.inspectorSession = session;
                await inspectorPost(session, 'Profiler.enable');
                await inspectorPost(session, 'Profiler.start');
                state.mainProfilePath = path.join(
                    state.outputDirectory,
                    'main.cpuprofile'
                );
                state.mainSnapshotPath = path.join(
                    state.outputDirectory,
                    'main.heapsnapshot'
                );
            }
            if (typeof runtimeProcess.threadCpuUsage !== 'function') {
                throw new Error('electron-main-thread-cpu-unavailable');
            }
            state.measurementStartedEpochMs = nowEpochMs();
            state.measurementPhase = 'measuring';
            state.cpuStart = runtimeProcess.threadCpuUsage();
            state.eventLoopStart = perfHooks.performance.eventLoopUtilization();
            state.eventLoopDelay = perfHooks.monitorEventLoopDelay({
                resolution: 1,
            });
            state.eventLoopDelay.enable();
            state.mainPeakHeap = 0;
            state.mainPeakRss = 0;
            for (const record of databaseRecords) {
                await startWorker(record);
            }
            sampleMain();
            state.sampleTimer = setInterval(sampleMain, 20);
            return state.measurementStartedEpochMs;
        };
        const startCapture = async (
            options: MainCaptureStartOptions
        ): Promise<void> => {
            const captureStartedEpochMs = nowEpochMs();
            state.rendererWindowSession?.detach();
            state.rendererWindowSession = null;
            state.stopping = false;
            state.captureGeneration += 1;
            state.active = true;
            state.captureInvalidReasons = [];
            state.captureOptions = { ...options };
            state.captureStartedEpochMs = captureStartedEpochMs;
            state.measurementPhase = 'armed';
            state.measurementStartedEpochMs = null;
            state.lateEventCount = 0;
            databaseRequestIdentityCapture.start();
            databaseWorkerCancelCapture.start(state.captureGeneration);
            xtreamIpcMarkerCapture.start(
                options.rendererWindowIdentity.webContentsId,
                captureStartedEpochMs
            );
            dbRequests.clear();
            operationWorkers.clear();
            state.diagnostic = options.diagnostic;
            state.outputDirectory = options.outputDirectory;
            state.timeline = [];
            state.mainPeakHeap = 0;
            state.mainPeakRss = 0;
            state.mainProfilePath = null;
            state.mainSnapshotPath = null;
            state.postGcHeap = null;
            state.postGcRss = null;
            state.cpuStart = null;
            state.eventLoopStart = null;
            state.eventLoopDelay = null;
            if (!options.deferMeasurement) {
                await beginMeasurement();
            }
        };

        const api = {
            status: (): MainCaptureStatus => ({
                databaseGetsCompleted: state.timeline.filter(
                    (entry) =>
                        entry['type'] === 'db-response' &&
                        entry['operation'] === 'DB_GET_APP_PLAYLIST' &&
                        entry['success'] === true
                ).length,
                databasePending: dbRequests.size,
                databaseRequests: state.timeline.filter(
                    (entry) => entry['type'] === 'db-request'
                ).length,
                databaseUpsertsCompleted: state.timeline.filter(
                    (entry) =>
                        entry['type'] === 'db-response' &&
                        entry['operation'] === 'DB_UPSERT_APP_PLAYLIST' &&
                        entry['success'] === true
                ).length,
                playlistTerminated: [...records.values()].filter(
                    (record) =>
                        isCurrentCaptureRecord(record) &&
                        record.kind === 'playlist-refresh.worker' &&
                        record.terminatedEpochMs !== null
                ).length,
                playlistResponsesFailed: state.timeline.filter(
                    (entry) =>
                        entry['type'] === 'playlist-response' &&
                        entry['success'] === false
                ).length,
                playlistResponses: state.timeline.filter(
                    (entry) => entry['type'] === 'playlist-response'
                ).length,
                playlistResponsesSucceeded: state.timeline.filter(
                    (entry) =>
                        entry['type'] === 'playlist-response' &&
                        entry['success'] === true
                ).length,
                preloadSuccessMarkers:
                    databaseRequestIdentityCapture.successMarkerCount(),
            }),
            start: async (options: MainCaptureStartOptions): Promise<void> => {
                databaseWorkerPostGcCutoffApi.beginCapture();
                await startCapture(options);
            },
            beginMeasurement: async (): Promise<number> => beginMeasurement(),
            stop: async (
                nextOptions?: MainCaptureStartOptions
            ): Promise<MainCaptureStopTransport> => {
                const captureCutoffEpochMs = nowEpochMs();
                const completedCaptureGeneration = state.captureGeneration;
                const completedCaptureStartedEpochMs =
                    state.captureStartedEpochMs;
                const completedMeasurementStartedEpochMs =
                    state.measurementStartedEpochMs;
                if (
                    !Number.isSafeInteger(completedCaptureGeneration) ||
                    completedCaptureGeneration <= 0 ||
                    completedCaptureStartedEpochMs === null ||
                    state.measurementPhase !== 'measuring' ||
                    completedMeasurementStartedEpochMs === null
                ) {
                    throw new Error(
                        'xtream-main-capture-generation-unavailable'
                    );
                }
                databaseWorkerPostGcCutoffApi.beginStop();
                state.stopping = true;
                state.active = false;
                state.measurementPhase = 'frozen';
                const operationOutcomes = readOperationOutcomes();
                const xtreamIpcSnapshot = xtreamIpcMarkerCapture.stop();
                const databaseWorkerCancelSnapshot =
                    databaseWorkerCancelCapture.stop();
                for (const reason of databaseWorkerCancelSnapshot.invalidReasons) {
                    state.timeline.push({
                        epochMs: nowEpochMs(),
                        type: `database-worker-cancel-capture-invalid:${reason}`,
                    });
                }
                for (const reason of xtreamIpcSnapshot.invalidReasons) {
                    state.timeline.push({
                        epochMs: nowEpochMs(),
                        type: `xtream-capture-invalid:${reason}`,
                    });
                }
                for (const marker of databaseRequestIdentityCapture.takeSuccessMarkers()) {
                    state.timeline.push({
                        epochMs: marker.sourceEpochMs,
                        ipcCallId: marker.ipcCallId,
                        operation: marker.operation,
                        operationId: marker.operationId ?? undefined,
                        playlistId: marker.playlistId,
                        sourceEpochMs: marker.sourceEpochMs,
                        success: true,
                        type: 'preload-performance-success',
                    });
                }
                databaseRequestIdentityCapture.stop();
                if (state.sampleTimer) {
                    clearInterval(state.sampleTimer);
                    state.sampleTimer = null;
                }
                const currentWorkerRecords = [...records.values()].filter(
                    (record) =>
                        record.captureGeneration === state.captureGeneration
                );
                const currentDatabaseRecords = currentWorkerRecords.filter(
                    (record) => record.kind === 'database.worker'
                );
                for (const record of currentWorkerRecords) {
                    stopWorkerSampling(record);
                }
                state.eventLoopDelay?.disable();
                sampleMain();
                const rendererWindow: RendererWindowRssSessionMetrics | null =
                    state.rendererWindowSession?.snapshot() ?? null;
                state.rendererWindowSession?.detach();
                state.rendererWindowSession = null;
                if (rendererWindow === null) {
                    throw new Error('renderer-window-session-missing');
                }
                const cpu = runtimeProcess.threadCpuUsage(
                    state.cpuStart ?? undefined
                );
                const eluEnd = perfHooks.performance.eventLoopUtilization();
                const elu = perfHooks.performance.eventLoopUtilization(
                    state.eventLoopStart ?? undefined
                );
                const eventLoopUtilization =
                    perfHooks.performance.nodeTiming.loopStart < 0 ||
                    (elu.active === 0 &&
                        elu.idle === 0 &&
                        eluEnd.active === 0 &&
                        eluEnd.idle === 0)
                        ? null
                        : elu.utilization;
                const delay = state.eventLoopDelay;
                const session =
                    state.inspectorSession ?? new inspector.Session();
                if (!state.inspectorSession) {
                    session.connect();
                }
                if (state.diagnostic && state.mainProfilePath) {
                    const result = await inspectorPost(
                        session,
                        'Profiler.stop'
                    );
                    fs.writeFileSync(
                        state.mainProfilePath,
                        JSON.stringify(result['profile']),
                        { encoding: 'utf8', flag: 'wx', mode: 0o600 }
                    );
                }
                await Promise.all(
                    currentDatabaseRecords.map((record) =>
                        joinFinalWorkerSample(record)
                    )
                );
                await Promise.all(
                    currentDatabaseRecords.map((record) =>
                        stopWorkerProfile(record)
                    )
                );
                await Promise.all(
                    currentWorkerRecords
                        .filter(
                            (record) =>
                                record.kind === 'playlist-refresh.worker' &&
                                record.finalizing !== null
                        )
                        .map((record) =>
                            waitForTerminatingWorkerFinalization(record)
                        )
                );
                const databaseSelection =
                    databaseWorkerPostGcSelectionApi.select(
                        currentWorkerRecords,
                        state.captureGeneration
                    );
                if (databaseSelection.selected) {
                    await finalizeDatabaseWorker(
                        databaseSelection.selected,
                        null
                    );
                } else if (databaseSelection.unavailableReason !== null) {
                    await Promise.all(
                        currentDatabaseRecords.map((record) =>
                            finalizeDatabaseWorker(
                                record,
                                databaseSelection.unavailableReason
                            )
                        )
                    );
                }
                flushWorkerProfiles(currentWorkerRecords);
                await inspectorPost(session, 'HeapProfiler.enable');
                await inspectorPost(session, 'HeapProfiler.collectGarbage');
                const postGc = process.memoryUsage();
                state.postGcHeap = postGc.heapUsed;
                state.postGcRss = postGc.rss;
                if (state.diagnostic && state.mainSnapshotPath) {
                    const output = fs.createWriteStream(
                        state.mainSnapshotPath,
                        { flags: 'wx', mode: 0o600 }
                    );
                    const onChunk = (message: { params: { chunk: string } }) =>
                        output.write(message.params.chunk);
                    session.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
                    await inspectorPost(
                        session,
                        'HeapProfiler.takeHeapSnapshot',
                        { reportProgress: false }
                    );
                    session.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
                    output.end();
                    await new Promise<void>((resolve, reject) => {
                        output.once('finish', resolve);
                        output.once('error', reject);
                    });
                }
                session.disconnect();
                state.inspectorSession = null;
                const cutoff = databaseWorkerPostGcCutoffApi.snapshot();
                if (cutoff.lateRequestCount > 0) {
                    for (const record of currentDatabaseRecords) {
                        record.postGcHeapUsed = null;
                        record.postGcHeapUnavailableReason =
                            'database-worker-activity-after-cutoff';
                    }
                }

                const workers = currentWorkerRecords
                    .filter(
                        (record) =>
                            record.kind === 'database.worker' ||
                            record.kind === 'playlist-refresh.worker'
                    )
                    .map((record) => ({
                        captureGeneration: record.captureGeneration,
                        metrics: {
                            cancelPostedEpochMs: record.cancelPostedEpochMs,
                            cpuSystemMicros:
                                record.cpuFirst && record.cpuLast
                                    ? record.cpuLast.system -
                                      record.cpuFirst.system
                                    : null,
                            cpuUserMicros:
                                record.cpuFirst && record.cpuLast
                                    ? record.cpuLast.user - record.cpuFirst.user
                                    : null,
                            eventLoopUtilization: record.elu,
                            externalMemorySampleCount:
                                record.externalMemorySampleCount,
                            heapUsedSampleCount: record.heapUsedSampleCount,
                            kind: record.kind,
                            operationId: record.operationId,
                            ordinal: record.ordinal,
                            peakExternalBytes:
                                record.externalMemorySampleCount > 0
                                    ? record.externalPeak
                                    : null,
                            peakExternalUnavailableReason:
                                record.externalMemorySampleCount > 0
                                    ? null
                                    : 'worker-external-memory-samples-missing',
                            peakHeapUsedBytes:
                                record.heapUsedSampleCount > 0
                                    ? record.heapPeak
                                    : null,
                            peakHeapUsedUnavailableReason:
                                record.heapUsedSampleCount > 0
                                    ? null
                                    : 'worker-heap-used-samples-missing',
                            playlistId: record.playlistId,
                            postGcHeapUnavailableReason:
                                record.postGcHeapUnavailableReason,
                            postGcHeapUsedBytes: record.postGcHeapUsed,
                            profilePath: record.profilePath,
                            responseEpochMs: record.responseEpochMs,
                            snapshotPath: record.snapshotPath,
                            terminatedEpochMs: record.terminatedEpochMs,
                        },
                        requests: record.requestPerformance.map((request) => ({
                            ipcCallId: request.identity.ipcCallId,
                            operation: request.operation,
                            operationId: request.identity.operationId,
                            operationIdUnavailableReason:
                                request.identity.operationIdUnavailableReason,
                            performanceCapture: request.performanceCapture,
                            playlistId: request.playlistId,
                            requestId: request.requestId,
                            responseEpochMs: request.responseEpochMs,
                            sourceEpochMs: request.identity.sourceEpochMs,
                            success: request.success,
                        })),
                    }));
                state.timeline = performanceTimelineMergeApi.merge(
                    state.timeline,
                    [
                        ...xtreamIpcSnapshot.timeline,
                        ...databaseWorkerCancelSnapshot.timeline,
                    ]
                );
                const transport: MainCaptureGenerationTransport = {
                    captureGeneration: state.captureGeneration,
                    metrics: {
                        cpuProfilePath: state.mainProfilePath,
                        cpuSystemMicros: cpu.system,
                        cpuUserMicros: cpu.user,
                        eventLoopDelay: {
                            maxMs: Number(delay?.max ?? 0) / 1e6,
                            p95Ms: Number(delay?.percentile(95) ?? 0) / 1e6,
                            p99Ms: Number(delay?.percentile(99) ?? 0) / 1e6,
                        },
                        // Electron's Chromium-owned main message pump currently
                        // leaves Node's libuv ELU counters at zero. Preserve that
                        // as unavailable instead of reporting a misleading 0%.
                        eventLoopUtilization,
                        eventLoopUtilizationUnavailableReason:
                            eventLoopUtilization === null
                                ? 'electron-main-embedded-event-loop'
                                : null,
                        heapSnapshotPath: state.mainSnapshotPath,
                        memory: {
                            peakHeapUsedBytes: state.mainPeakHeap,
                            peakRssBytes: state.mainPeakRss,
                            postGcHeapUsedBytes: state.postGcHeap,
                            postGcRssBytes: state.postGcRss,
                        },
                        rendererWindow,
                        rssScope:
                            'electron-main-process-including-worker-threads-and-native-memory',
                        timeline: state.timeline,
                    },
                    workers,
                };
                const captureStoppedEpochMs = nowEpochMs();
                const xtream = {
                    cancelCapture: databaseWorkerCancelSnapshot,
                    captureCutoffEpochMs,
                    captureGeneration: completedCaptureGeneration,
                    captureStartedEpochMs: completedCaptureStartedEpochMs,
                    captureStoppedEpochMs,
                    databaseWorkerCount: currentDatabaseRecords.length,
                    invalidReasons: [...state.captureInvalidReasons],
                    ipcCapture: xtreamIpcSnapshot,
                    lateDatabaseRequestCount: cutoff.lateRequestCount,
                    lateEventCount: state.lateEventCount,
                    measurementStartedEpochMs:
                        completedMeasurementStartedEpochMs,
                    operationOutcomes,
                    playlistRefreshWorkerCount: currentWorkerRecords.filter(
                        ({ kind }) => kind === 'playlist-refresh.worker'
                    ).length,
                };
                let rollover: MainCaptureRolloverStatus | null = null;
                if (nextOptions) {
                    const databaseRecord =
                        currentDatabaseRecords.length === 1
                            ? currentDatabaseRecords[0]
                            : null;
                    const nextCaptureUnavailableReason =
                        cutoff.lateRequestCount > 0
                            ? 'database-worker-activity-after-cutoff'
                            : dbRequests.size > 0
                              ? 'database-worker-not-idle'
                              : currentDatabaseRecords.length === 0
                                ? 'database-worker-missing'
                                : currentDatabaseRecords.length > 1
                                  ? 'multiple-database-workers'
                                  : !databaseRecord ||
                                      !Number.isSafeInteger(
                                          databaseRecord.postGcHeapUsed
                                      ) ||
                                      Number(databaseRecord.postGcHeapUsed) <
                                          0 ||
                                      databaseRecord.postGcHeapUnavailableReason !==
                                          null
                                    ? (databaseRecord?.postGcHeapUnavailableReason ??
                                      'post-gc-capture-invalid')
                                    : null;
                    if (nextCaptureUnavailableReason === null) {
                        databaseWorkerPostGcCutoffApi.rolloverCapture();
                        await startCapture(nextOptions);
                        rollover = {
                            nextCaptureStarted: true,
                            nextCaptureUnavailableReason: null,
                        };
                    } else {
                        databaseWorkerPostGcCutoffApi.finishStop();
                        state.stopping = false;
                        rollover = {
                            nextCaptureStarted: false,
                            nextCaptureUnavailableReason,
                        };
                    }
                } else {
                    databaseWorkerPostGcCutoffApi.finishStop();
                    state.stopping = false;
                }
                return { ...transport, rollover, xtream };
            },
            xtreamStatus: (): XtreamMainCaptureStatus => {
                if (
                    !Number.isSafeInteger(state.captureGeneration) ||
                    state.captureGeneration <= 0 ||
                    state.captureStartedEpochMs === null
                ) {
                    throw new Error(
                        'xtream-main-capture-generation-unavailable'
                    );
                }
                const cutoff = databaseWorkerPostGcCutoffApi.snapshot();
                const currentWorkers = [...records.values()].filter(
                    (record) =>
                        record.captureGeneration === state.captureGeneration
                );
                return {
                    active: state.active,
                    activeOperations: [...dbRequests.entries()]
                        .map(([requestId, request]) => ({
                            operation: request.operation,
                            operationId: request.identity.operationId,
                            playlistId: request.playlistId,
                            progress: request.progress
                                ? { ...request.progress }
                                : null,
                            requestId,
                        }))
                        .sort(
                            (left, right) =>
                                left.operation.localeCompare(right.operation) ||
                                left.requestId.localeCompare(right.requestId)
                        ),
                    captureGeneration: state.captureGeneration,
                    captureStartedEpochMs: state.captureStartedEpochMs,
                    cutoffPhase: cutoff.phase,
                    databaseWorkerCount: currentWorkers.filter(
                        ({ kind }) => kind === 'database.worker'
                    ).length,
                    invalidReasons: [...state.captureInvalidReasons],
                    lateDatabaseRequestCount: cutoff.lateRequestCount,
                    lateEventCount: state.lateEventCount,
                    measurementPhase: state.measurementPhase,
                    measurementStartedEpochMs: state.measurementStartedEpochMs,
                    operationOutcomes: readOperationOutcomes(),
                    playlistRefreshWorkerCount: currentWorkers.filter(
                        ({ kind }) => kind === 'playlist-refresh.worker'
                    ).length,
                };
            },
        };
        target[input.stateKey] = api;
    }, captureStateKeys);
}

const XTREAM_CAPTURE_OPERATION_PATTERN = /^DB_[A-Z0-9_]{1,124}$/;
const XTREAM_CAPTURE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const XTREAM_CAPTURE_REASON_PATTERN = /^[a-z0-9][a-z0-9:-]{0,159}$/;
const XTREAM_IPC_TIMELINE_TYPES = new Set([
    'xtream-main-phase',
    'xtream-preload-marker',
]);
const XTREAM_CANCEL_TIMELINE_TYPES = new Set([
    'db-cancel-dispatched',
    'db-cancel-received',
    'db-cancel-terminal-received',
]);

function xtreamCaptureInvalid(kind: 'status' | 'transport'): never {
    throw new Error(`xtream-main-capture-${kind}-invalid`);
}

function isFinitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

function snapshotXtreamReasons(
    input: readonly string[],
    kind: 'status' | 'transport'
): readonly string[] {
    if (
        !Array.isArray(input) ||
        input.some(
            (reason) =>
                typeof reason !== 'string' ||
                !XTREAM_CAPTURE_REASON_PATTERN.test(reason)
        )
    ) {
        xtreamCaptureInvalid(kind);
    }
    return Object.freeze([...input]);
}

function snapshotXtreamOperationOutcomes(
    input: readonly XtreamMainCaptureOperationOutcome[],
    kind: 'status' | 'transport'
): readonly XtreamMainCaptureOperationOutcome[] {
    if (!Array.isArray(input)) xtreamCaptureInvalid(kind);
    const seen = new Set<string>();
    const outcomes = input.map((entry) => {
        if (
            typeof entry !== 'object' ||
            entry === null ||
            !XTREAM_CAPTURE_OPERATION_PATTERN.test(entry.operation) ||
            !['error', 'pending', 'success'].includes(entry.outcome) ||
            !Number.isSafeInteger(entry.count) ||
            entry.count <= 0
        ) {
            xtreamCaptureInvalid(kind);
        }
        const key = `${entry.operation}:${entry.outcome}`;
        if (seen.has(key)) xtreamCaptureInvalid(kind);
        seen.add(key);
        return Object.freeze({ ...entry });
    });
    return Object.freeze(outcomes);
}

function snapshotXtreamProgress(
    input: XtreamMainCaptureOperationProgress | null,
    captureStartedEpochMs: number
): XtreamMainCaptureOperationProgress | null {
    if (input === null) return null;
    if (
        typeof input !== 'object' ||
        !isFinitePositive(input.epochMs) ||
        input.epochMs < captureStartedEpochMs ||
        !['cancelled', 'completed', 'error', 'progress', 'started'].includes(
            input.status
        ) ||
        !(
            input.phase === null || /^[a-z][a-z0-9-]{0,127}$/.test(input.phase)
        ) ||
        !(
            input.current === null ||
            (Number.isFinite(input.current) && input.current >= 0)
        ) ||
        !(
            input.total === null ||
            (Number.isFinite(input.total) && input.total >= 0)
        )
    ) {
        xtreamCaptureInvalid('status');
    }
    return Object.freeze({ ...input });
}

function snapshotXtreamStatus(
    input: XtreamMainCaptureStatus
): XtreamMainCaptureStatus {
    if (
        typeof input !== 'object' ||
        input === null ||
        typeof input.active !== 'boolean' ||
        !Number.isSafeInteger(input.captureGeneration) ||
        input.captureGeneration <= 0 ||
        !isFinitePositive(input.captureStartedEpochMs) ||
        !['armed', 'frozen', 'measuring'].includes(input.measurementPhase) ||
        !(
            (input.measurementPhase === 'armed' &&
                input.measurementStartedEpochMs === null) ||
            (input.measurementPhase !== 'armed' &&
                isFinitePositive(input.measurementStartedEpochMs) &&
                input.measurementStartedEpochMs >= input.captureStartedEpochMs)
        ) ||
        !['active', 'idle', 'stopping'].includes(input.cutoffPhase) ||
        !isNonNegativeSafeInteger(input.databaseWorkerCount) ||
        !isNonNegativeSafeInteger(input.playlistRefreshWorkerCount) ||
        !isNonNegativeSafeInteger(input.lateDatabaseRequestCount) ||
        !isNonNegativeSafeInteger(input.lateEventCount) ||
        input.lateEventCount !== input.lateDatabaseRequestCount ||
        !Array.isArray(input.activeOperations)
    ) {
        xtreamCaptureInvalid('status');
    }
    const activeOperations = input.activeOperations.map((entry) => {
        if (
            typeof entry !== 'object' ||
            entry === null ||
            !XTREAM_CAPTURE_OPERATION_PATTERN.test(entry.operation) ||
            !XTREAM_CAPTURE_IDENTIFIER_PATTERN.test(entry.requestId) ||
            !(
                entry.operationId === null ||
                XTREAM_CAPTURE_IDENTIFIER_PATTERN.test(entry.operationId)
            ) ||
            !(
                entry.playlistId === null ||
                XTREAM_CAPTURE_IDENTIFIER_PATTERN.test(entry.playlistId)
            )
        ) {
            xtreamCaptureInvalid('status');
        }
        return Object.freeze({
            ...entry,
            progress: snapshotXtreamProgress(
                entry.progress,
                input.captureStartedEpochMs
            ),
        });
    });
    return Object.freeze({
        ...input,
        activeOperations: Object.freeze(activeOperations),
        invalidReasons: snapshotXtreamReasons(input.invalidReasons, 'status'),
        operationOutcomes: snapshotXtreamOperationOutcomes(
            input.operationOutcomes,
            'status'
        ),
    });
}

function snapshotXtreamIpcTimeline(
    input: XtreamIpcMarkerCaptureSnapshot,
    startedEpochMs: number,
    cutoffEpochMs: number
): readonly XtreamIpcTimelineRecord[] {
    if (!Array.isArray(input.timeline)) xtreamCaptureInvalid('transport');
    return Object.freeze(
        input.timeline.map((record) => {
            if (
                typeof record !== 'object' ||
                record === null ||
                !XTREAM_IPC_TIMELINE_TYPES.has(record.type) ||
                !['end', 'start'].includes(record.boundary) ||
                !isFinitePositive(record.epochMs) ||
                record.epochMs < startedEpochMs ||
                record.epochMs > cutoffEpochMs
            ) {
                xtreamCaptureInvalid('transport');
            }
            return Object.freeze({ ...record });
        })
    );
}

function snapshotXtreamCancelTimeline(
    input: DatabaseWorkerCancelCaptureSnapshot,
    startedEpochMs: number,
    cutoffEpochMs: number
): readonly DatabaseWorkerCancelTimelineRecord[] {
    if (!Array.isArray(input.timeline)) xtreamCaptureInvalid('transport');
    return Object.freeze(
        input.timeline.map((record) => {
            if (
                typeof record !== 'object' ||
                record === null ||
                !XTREAM_CANCEL_TIMELINE_TYPES.has(record.type) ||
                !isFinitePositive(record.epochMs) ||
                record.epochMs < startedEpochMs ||
                record.epochMs > cutoffEpochMs ||
                !Number.isSafeInteger(record.ipcCallId) ||
                record.ipcCallId <= 0 ||
                !XTREAM_CAPTURE_IDENTIFIER_PATTERN.test(record.operationId) ||
                !XTREAM_CAPTURE_IDENTIFIER_PATTERN.test(record.requestId) ||
                !isFinitePositive(record.sourceEpochMs) ||
                record.sourceEpochMs > record.epochMs
            ) {
                xtreamCaptureInvalid('transport');
            }
            return Object.freeze({ ...record });
        })
    );
}

function snapshotXtreamResult(
    input: XtreamMainCaptureTransport
): XtreamMainCaptureResult {
    try {
        const evidence = input.xtream;
        if (
            !Number.isSafeInteger(input.captureGeneration) ||
            input.captureGeneration <= 0 ||
            evidence.captureGeneration !== input.captureGeneration ||
            !isFinitePositive(evidence.captureStartedEpochMs) ||
            !isFinitePositive(evidence.measurementStartedEpochMs) ||
            !isFinitePositive(evidence.captureCutoffEpochMs) ||
            !isFinitePositive(evidence.captureStoppedEpochMs) ||
            evidence.captureCutoffEpochMs < evidence.captureStartedEpochMs ||
            evidence.measurementStartedEpochMs <
                evidence.captureStartedEpochMs ||
            evidence.captureCutoffEpochMs <
                evidence.measurementStartedEpochMs ||
            evidence.captureStoppedEpochMs < evidence.captureCutoffEpochMs ||
            !isNonNegativeSafeInteger(evidence.databaseWorkerCount) ||
            !isNonNegativeSafeInteger(evidence.playlistRefreshWorkerCount) ||
            !isNonNegativeSafeInteger(
                evidence.ipcCapture.quarantinedKeyCount
            ) ||
            !isNonNegativeSafeInteger(evidence.lateDatabaseRequestCount) ||
            !isNonNegativeSafeInteger(evidence.lateEventCount) ||
            evidence.lateEventCount !== evidence.lateDatabaseRequestCount
        ) {
            xtreamCaptureInvalid('transport');
        }
        const capture = selectMainCaptureGeneration(input);
        const workers = Object.freeze([...capture.workers]);
        const requests = Object.freeze(
            workers.flatMap((worker) => worker.requests)
        );
        if (
            workers.filter(({ kind }) => kind === 'database.worker').length !==
                evidence.databaseWorkerCount ||
            workers.filter(({ kind }) => kind === 'playlist-refresh.worker')
                .length !== evidence.playlistRefreshWorkerCount
        ) {
            xtreamCaptureInvalid('transport');
        }
        const rollover =
            input.rollover === null
                ? null
                : Object.freeze({ ...input.rollover });
        if (
            rollover !== null &&
            (typeof rollover.nextCaptureStarted !== 'boolean' ||
                !(
                    rollover.nextCaptureUnavailableReason === null ||
                    typeof rollover.nextCaptureUnavailableReason === 'string'
                ))
        ) {
            xtreamCaptureInvalid('transport');
        }
        const operationOutcomes = snapshotXtreamOperationOutcomes(
            evidence.operationOutcomes,
            'transport'
        );
        const completedOutcomes = new Map<string, number>();
        for (const worker of workers) {
            if (worker.kind !== 'database.worker') continue;
            for (const request of worker.requests) {
                if (
                    typeof request.operation !== 'string' ||
                    !XTREAM_CAPTURE_OPERATION_PATTERN.test(request.operation)
                ) {
                    xtreamCaptureInvalid('transport');
                }
                const key = `${request.operation}:${
                    request.success ? 'success' : 'error'
                }`;
                completedOutcomes.set(
                    key,
                    (completedOutcomes.get(key) ?? 0) + 1
                );
            }
        }
        const capturedCompletedOutcomes = new Map(
            operationOutcomes
                .filter(({ outcome }) => outcome !== 'pending')
                .map(({ count, operation, outcome }) => [
                    `${operation}:${outcome}`,
                    count,
                ])
        );
        if (
            completedOutcomes.size !== capturedCompletedOutcomes.size ||
            [...completedOutcomes].some(
                ([key, count]) => capturedCompletedOutcomes.get(key) !== count
            )
        ) {
            xtreamCaptureInvalid('transport');
        }
        const ipcTimeline = snapshotXtreamIpcTimeline(
            evidence.ipcCapture,
            evidence.captureStartedEpochMs,
            evidence.captureCutoffEpochMs
        );
        const cancelTimeline = snapshotXtreamCancelTimeline(
            evidence.cancelCapture,
            evidence.captureStartedEpochMs,
            evidence.captureCutoffEpochMs
        );
        return Object.freeze({
            cancelTimeline,
            capture: Object.freeze({ ...capture, workers }),
            captureCutoffEpochMs: evidence.captureCutoffEpochMs,
            captureGeneration: evidence.captureGeneration,
            captureStartedEpochMs: evidence.captureStartedEpochMs,
            captureStoppedEpochMs: evidence.captureStoppedEpochMs,
            databaseWorkerCount: evidence.databaseWorkerCount,
            invalidReasons: Object.freeze({
                capture: snapshotXtreamReasons(
                    evidence.invalidReasons,
                    'transport'
                ),
                databaseWorkerCancel: snapshotXtreamReasons(
                    evidence.cancelCapture.invalidReasons,
                    'transport'
                ),
                xtreamIpc: snapshotXtreamReasons(
                    evidence.ipcCapture.invalidReasons,
                    'transport'
                ),
            }),
            ipcTimeline,
            lateDatabaseRequestCount: evidence.lateDatabaseRequestCount,
            lateEventCount: evidence.lateEventCount,
            measurementStartedEpochMs: evidence.measurementStartedEpochMs,
            operationOutcomes,
            playlistRefreshWorkerCount: evidence.playlistRefreshWorkerCount,
            quarantinedIpcMarkerCount: evidence.ipcCapture.quarantinedKeyCount,
            requests,
            rollover,
            workers,
        });
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'xtream-main-capture-transport-invalid'
        ) {
            throw error;
        }
        return xtreamCaptureInvalid('transport');
    }
}

export async function startMainCapture(
    electronApp: ElectronApplication,
    options: MainCaptureStartOptions
): Promise<void> {
    await electronApp.evaluate(
        async (_electron, input) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const api = target[input.stateKey] as {
                start(options: MainCaptureStartOptions): Promise<void>;
            };
            await api.start(input.options);
        },
        { options, stateKey: MAIN_CAPTURE_STATE_KEY }
    );
}

export async function beginXtreamMainMeasurement(
    electronApp: ElectronApplication
): Promise<number> {
    return electronApp.evaluate(async (_electron, stateKey) => {
        const target = globalThis as unknown as Record<string, unknown>;
        const api = target[stateKey] as {
            beginMeasurement(): Promise<number>;
        };
        return api.beginMeasurement();
    }, MAIN_CAPTURE_STATE_KEY);
}

export async function readMainCaptureStatus(
    electronApp: ElectronApplication
): Promise<MainCaptureStatus> {
    return electronApp.evaluate(async (_electron, stateKey) => {
        const target = globalThis as unknown as Record<string, unknown>;
        const api = target[stateKey] as {
            status(): MainCaptureStatus;
        };
        return api.status();
    }, MAIN_CAPTURE_STATE_KEY);
}

export async function readXtreamMainCaptureStatus(
    electronApp: ElectronApplication
): Promise<XtreamMainCaptureStatus> {
    const status = await electronApp.evaluate((_electron, stateKey) => {
        const target = globalThis as unknown as Record<string, unknown>;
        const api = target[stateKey] as {
            xtreamStatus(): XtreamMainCaptureStatus;
        };
        return api.xtreamStatus();
    }, MAIN_CAPTURE_STATE_KEY);
    return snapshotXtreamStatus(status);
}

export async function rolloverMainCapture(
    electronApp: ElectronApplication,
    options: MainCaptureStartOptions
): Promise<MainCaptureRolloverResult> {
    const transport = await electronApp.evaluate(
        async (_electron, input) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const api = target[input.stateKey] as {
                stop(
                    nextOptions?: MainCaptureStartOptions
                ): Promise<MainCaptureStopTransport>;
            };
            return api.stop(input.options);
        },
        { options, stateKey: MAIN_CAPTURE_STATE_KEY }
    );
    if (transport.rollover === null) {
        throw new Error('main-capture-rollover-status-missing');
    }
    return Object.freeze({
        completedCapture: selectMainCaptureGeneration(transport),
        nextCaptureStarted: transport.rollover.nextCaptureStarted,
        nextCaptureUnavailableReason:
            transport.rollover.nextCaptureUnavailableReason,
    });
}

export async function stopMainCapture(
    electronApp: ElectronApplication
): Promise<MainCaptureMetrics> {
    const transport = await electronApp.evaluate(
        async (_electron, stateKey) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const api = target[stateKey] as {
                stop(): Promise<MainCaptureStopTransport>;
            };
            return api.stop();
        },
        MAIN_CAPTURE_STATE_KEY
    );
    return selectMainCaptureGeneration(transport);
}

export async function rolloverXtreamMainCapture(
    electronApp: ElectronApplication,
    options: MainCaptureStartOptions
): Promise<XtreamMainCaptureResult> {
    const transport = await electronApp.evaluate(
        async (_electron, input) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const api = target[input.stateKey] as {
                stop(
                    nextOptions?: MainCaptureStartOptions
                ): Promise<XtreamMainCaptureTransport>;
            };
            return api.stop(input.options);
        },
        { options, stateKey: MAIN_CAPTURE_STATE_KEY }
    );
    const result = snapshotXtreamResult(transport);
    if (result.rollover === null) {
        throw new Error('xtream-main-capture-rollover-status-missing');
    }
    return result;
}

export async function stopXtreamMainCapture(
    electronApp: ElectronApplication
): Promise<XtreamMainCaptureResult> {
    const transport = await electronApp.evaluate(
        async (_electron, stateKey) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const api = target[stateKey] as {
                stop(): Promise<XtreamMainCaptureTransport>;
            };
            return api.stop();
        },
        MAIN_CAPTURE_STATE_KEY
    );
    const result = snapshotXtreamResult(transport);
    if (result.rollover !== null) {
        throw new Error('xtream-main-capture-stop-rollover-unexpected');
    }
    return result;
}
