/* eslint-disable max-lines -- The injected main-process protocol must remain self-contained for Playwright serialization. */
import type { ElectronApplication } from '@playwright/test';

import {
    DATABASE_REQUEST_IDENTITY_CAPTURE_STATE_KEY,
    installDatabaseRequestIdentityCapture,
    type DatabaseRequestIdentity,
    type DatabaseRequestIdentityCaptureApi,
} from './database-request-identity-capture';
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
    WorkerPostGcHeapUnavailableReason,
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

const MAIN_CAPTURE_STATE_KEY = '__iptvnatorM3uRefreshMainCapture';

export interface MainCaptureStartOptions {
    readonly diagnostic: boolean;
    readonly outputDirectory: string;
    readonly rendererWindowIdentity: RendererWindowIdentity;
}

export interface MainCaptureStatus {
    readonly databasePending: number;
    readonly databaseRequests: number;
    readonly databaseUpsertsCompleted: number;
    readonly playlistTerminated: number;
    readonly playlistResponsesFailed: number;
    readonly playlistResponses: number;
    readonly playlistResponsesSucceeded: number;
}

export interface MainCaptureRolloverResult {
    readonly completedCapture: MainCaptureMetrics;
    readonly nextCaptureStarted: boolean;
    readonly nextCaptureUnavailableReason: string | null;
}

interface MainCaptureRolloverStatus {
    readonly nextCaptureStarted: boolean;
    readonly nextCaptureUnavailableReason: string | null;
}

type MainCaptureStopTransport = MainCaptureGenerationTransport & {
    readonly rollover: MainCaptureRolloverStatus | null;
};

export async function installMainCapture(
    electronApp: ElectronApplication
): Promise<void> {
    await installDatabaseRequestIdentityCapture(electronApp);
    const captureStateKeys = {
        databaseRequestIdentityStateKey:
            DATABASE_REQUEST_IDENTITY_CAPTURE_STATE_KEY,
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
        stateKey: MAIN_CAPTURE_STATE_KEY,
        workerTerminationGenerationApiFactorySource:
            createWorkerTerminationGenerationApi.toString(),
    };
    await electronApp.evaluate(async ({ app, BrowserWindow }, input) => {
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
            externalPeak: number;
            finalized: boolean;
            finalizationKey: object;
            finalizationTimedOut: boolean;
            finalizing: Promise<void> | null;
            heapPeak: number;
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
            sampleTimer: NodeJS.Timeout | null;
            snapshotPath: string | null;
            terminatedEpochMs: number | null;
            worker: InstrumentedWorker;
        }
        interface TimelineRecord {
            readonly epochMs: number;
            readonly operation?: string;
            readonly operationId?: string;
            readonly playlistId?: string;
            readonly requestId?: string;
            readonly success?: boolean;
            readonly type: string;
        }

        const target = globalThis as unknown as Record<string, unknown>;
        if (target[input.stateKey] !== undefined) {
            return;
        }
        const databaseRequestIdentityCapture = target[
            input.databaseRequestIdentityStateKey
        ] as DatabaseRequestIdentityCaptureApi;
        const restoreFactory = <T>(source: string): T => {
            const factory = new Function(
                `"use strict"; return (${source});`
            )() as () => T;
            return factory();
        };
        const databaseWorkerPostGcCutoffApi =
            restoreFactory<DatabaseWorkerPostGcCutoffApi>(
                input.databaseWorkerPostGcCutoffApiFactorySource
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

        const runtimeProcess = process as typeof process & {
            getBuiltinModule(id: string): unknown;
        };
        const fs = runtimeProcess.getBuiltinModule(
            'node:fs'
        ) as typeof import('node:fs');
        const inspector = runtimeProcess.getBuiltinModule(
            'node:inspector'
        ) as typeof import('node:inspector');
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
                record: WorkerRecord;
            }
        >();

        const state = {
            active: false,
            captureGeneration: 0,
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
            outputDirectory: '',
            postGcHeap: null as number | null,
            postGcRss: null as number | null,
            rendererWindowSession: null as RendererWindowRssSession | null,
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
                externalPeak: 0,
                finalized: false,
                finalizationKey: {},
                finalizationTimedOut: false,
                finalizing: null,
                heapPeak: 0,
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
                sampleTimer: null,
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
                                operationId: record.operationId,
                                operationIdUnavailableReason: null,
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
                        record.heapPeak = Math.max(
                            record.heapPeak,
                            Number(stats.used_heap_size ?? 0)
                        );
                        record.externalPeak = Math.max(
                            record.externalPeak,
                            Number(stats.external_memory ?? 0)
                        );
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
            if (record.sampleTimer) {
                clearInterval(record.sampleTimer);
            }
            record.cancelPostedEpochMs = null;
            record.captureGeneration = state.captureGeneration;
            record.cpuFirst = null;
            record.cpuLast = null;
            record.elu = null;
            record.eluStart = null;
            record.externalPeak = 0;
            record.finalized = false;
            record.finalizationKey = {};
            record.finalizationTimedOut = false;
            record.finalizing = null;
            record.heapPeak = 0;
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
            record.sampleTimer = null;
            record.snapshotPath = null;
            record.terminatedEpochMs = null;
        };
        const startWorker = (record: WorkerRecord): void => {
            if (!state.active) {
                return;
            }
            if (record.captureGeneration !== state.captureGeneration) {
                resetWorkerForCapture(record);
            }
            if (record.sampleTimer !== null) {
                return;
            }
            record.elu = null;
            record.eluStart =
                record.worker.performance?.eventLoopUtilization() ?? null;
            void sampleWorker(record);
            record.sampleTimer = setInterval(
                () => void sampleWorker(record),
                20
            );
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
                void profileHandle.then(
                    (handle) => {
                        if (
                            record.profileCaptureKey === profileCaptureKey &&
                            record.profileHandle === profileHandle
                        ) {
                            record.resolvedProfileHandle = handle;
                        }
                    },
                    () => undefined
                );
            }
        };
        const stopWorkerSampling = (record: WorkerRecord): void => {
            if (record.sampleTimer) {
                clearInterval(record.sampleTimer);
                record.sampleTimer = null;
            }
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
                JSON.stringify(normalizeWorkerCpuProfile(record.profileResult))
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
                fs.createWriteStream(record.snapshotPath)
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
                    joinFinalSample: () => joinFinalWorkerSample(record),
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
                    stopProfile: () => stopWorkerProfile(record),
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
                        startWorker(record);
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
                            const identity =
                                payloadOperationId === null
                                    ? databaseRequestIdentityCapture.matchDatabaseRequest(
                                          value
                                      )
                                    : {
                                          operationId: payloadOperationId,
                                          operationIdUnavailableReason: null,
                                      };
                            record.pendingCount += 1;
                            dbRequests.set(value['requestId'], {
                                identity,
                                operation: value['operation'],
                                playlistId: readDatabasePlaylistId(value),
                                record,
                            });
                            recordTimeline({
                                operation: value['operation'],
                                operationId: identity.operationId ?? undefined,
                                playlistId:
                                    readDatabasePlaylistId(value) ?? undefined,
                                requestId: value['requestId'],
                                type: 'db-request',
                            });
                        }
                    }
                } else if (
                    value['type'] === 'cancel' &&
                    typeof value['operationId'] === 'string'
                ) {
                    const record = operationWorkers.get(value['operationId']);
                    if (record) {
                        record.cancelPostedEpochMs = nowEpochMs();
                        recordTimeline({
                            operationId: value['operationId'],
                            type: 'playlist-cancel-posted',
                        });
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
        };
        const startCapture = async (
            options: MainCaptureStartOptions
        ): Promise<void> => {
            state.rendererWindowSession?.detach();
            state.rendererWindowSession = null;
            const rendererWindowSession = rendererWindowRssSessionApi.create({
                browserWindowFromId: (browserWindowId) =>
                    BrowserWindow.fromId(browserWindowId),
                browserWindowId: options.rendererWindowIdentity.browserWindowId,
                getAppMetrics: () => app.getAppMetrics(),
                rendererRssApi: rendererProcessRssApi,
                webContentsId: options.rendererWindowIdentity.webContentsId,
            });
            state.stopping = false;
            state.captureGeneration += 1;
            state.active = true;
            databaseRequestIdentityCapture.start();
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
            state.rendererWindowSession = rendererWindowSession;
            state.cpuStart = process.cpuUsage();
            state.eventLoopStart = perfHooks.performance.eventLoopUtilization();
            state.eventLoopDelay = perfHooks.monitorEventLoopDelay({
                resolution: 1,
            });
            state.eventLoopDelay.enable();
            sampleMain();
            state.sampleTimer = setInterval(sampleMain, 20);
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
        };

        const api = {
            status: (): MainCaptureStatus => ({
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
            }),
            start: async (options: MainCaptureStartOptions): Promise<void> => {
                databaseWorkerPostGcCutoffApi.beginCapture();
                await startCapture(options);
            },
            stop: async (
                nextOptions?: MainCaptureStartOptions
            ): Promise<MainCaptureStopTransport> => {
                databaseWorkerPostGcCutoffApi.beginStop();
                state.stopping = true;
                state.active = false;
                databaseRequestIdentityCapture.stop();
                if (state.sampleTimer) {
                    clearInterval(state.sampleTimer);
                    state.sampleTimer = null;
                }
                const currentWorkerRecords = [...records.values()].filter(
                    (record) =>
                        record.captureGeneration === state.captureGeneration
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
                const cpu = process.cpuUsage(state.cpuStart ?? undefined);
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
                        JSON.stringify(result['profile'])
                    );
                }
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
                const currentDatabaseRecords = currentWorkerRecords.filter(
                    (record) => record.kind === 'database.worker'
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
                    const output = fs.createWriteStream(state.mainSnapshotPath);
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
                            kind: record.kind,
                            operationId: record.operationId,
                            ordinal: record.ordinal,
                            peakExternalBytes: record.externalPeak,
                            peakHeapUsedBytes: record.heapPeak,
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
                            operation: request.operation,
                            operationId: request.identity.operationId,
                            operationIdUnavailableReason:
                                request.identity.operationIdUnavailableReason,
                            performanceCapture: request.performanceCapture,
                            playlistId: request.playlistId,
                            requestId: request.requestId,
                            responseEpochMs: request.responseEpochMs,
                            success: request.success,
                        })),
                    }));
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
                return { ...transport, rollover };
            },
        };
        target[input.stateKey] = api;
    }, captureStateKeys);
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
