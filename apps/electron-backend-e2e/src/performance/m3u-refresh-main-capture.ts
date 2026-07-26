/* eslint-disable max-lines -- The injected main-process protocol must remain self-contained for Playwright serialization. */
import type { ElectronApplication } from '@playwright/test';

import {
    DATABASE_REQUEST_IDENTITY_CAPTURE_STATE_KEY,
    installDatabaseRequestIdentityCapture,
    type DatabaseRequestIdentity,
    type DatabaseRequestIdentityCaptureApi,
} from './database-request-identity-capture';
import type { MainCaptureMetrics } from './m3u-refresh-cancellation-contract';
import {
    selectMainCaptureGeneration,
    type MainCaptureGenerationTransport,
} from './worker-request-performance';

const MAIN_CAPTURE_STATE_KEY = '__iptvnatorM3uRefreshMainCapture';

export interface MainCaptureStartOptions {
    readonly diagnostic: boolean;
    readonly outputDirectory: string;
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

export async function installMainCapture(
    electronApp: ElectronApplication
): Promise<void> {
    await installDatabaseRequestIdentityCapture(electronApp);
    const captureStateKeys = {
        databaseRequestIdentityStateKey:
            DATABASE_REQUEST_IDENTITY_CAPTURE_STATE_KEY,
        stateKey: MAIN_CAPTURE_STATE_KEY,
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
            finalizing: Promise<void> | null;
            heapPeak: number;
            kind: 'database.worker' | 'playlist-refresh.worker';
            operationId: string | null;
            playlistId: string | null;
            postGcHeapUsed: number | null;
            profileHandle: Promise<CpuProfileHandle> | null;
            profilePath: string | null;
            requestPerformance: WorkerRequestPerformance[];
            responseEpochMs: number | null;
            sampleBusy: boolean;
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
            rendererPeakRss: 0,
            responsiveEvents: 0,
            sampleTimer: null as NodeJS.Timeout | null,
            timeline: [] as TimelineRecord[],
            unresponsiveEvents: 0,
            windowListeners: [] as {
                responsive: () => void;
                unresponsive: () => void;
                window: Electron.BrowserWindow;
            }[],
        };

        const nowEpochMs = (): number =>
            perfHooks.performance.timeOrigin + perfHooks.performance.now();
        const recordTimeline = (
            record: Omit<TimelineRecord, 'epochMs'>
        ): void => {
            if (state.active) {
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
                finalizing: null,
                heapPeak: 0,
                kind,
                operationId: null,
                playlistId: null,
                postGcHeapUsed: null,
                profileHandle: null,
                profilePath: null,
                requestPerformance: [],
                responseEpochMs: null,
                sampleBusy: false,
                sampleTimer: null,
                snapshotPath: null,
                terminatedEpochMs: null,
                worker,
            };
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
        const sampleWorker = async (record: WorkerRecord): Promise<void> => {
            if (record.sampleBusy || record.finalized) {
                return;
            }
            record.sampleBusy = true;
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
            } finally {
                record.sampleBusy = false;
            }
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
            record.finalizing = null;
            record.heapPeak = 0;
            record.operationId = null;
            record.playlistId = null;
            record.postGcHeapUsed = null;
            record.profileHandle = null;
            record.profilePath = null;
            record.requestPerformance = [];
            record.responseEpochMs = null;
            record.sampleBusy = false;
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
                    `${record.kind}.cpuprofile`
                );
                record.profileHandle = record.worker.startCpuProfile();
            }
        };
        const finalizeWorker = (record: WorkerRecord): Promise<void> => {
            record.finalizing ??= (async () => {
                if (record.sampleTimer) {
                    clearInterval(record.sampleTimer);
                    record.sampleTimer = null;
                }
                await sampleWorker(record);
                if (record.profileHandle && record.profilePath) {
                    const handle = await record.profileHandle;
                    const profile = await handle.stop();
                    fs.writeFileSync(
                        record.profilePath,
                        JSON.stringify(normalizeWorkerCpuProfile(profile))
                    );
                }
                if (
                    state.diagnostic &&
                    typeof record.worker.getHeapSnapshot === 'function'
                ) {
                    record.snapshotPath = path.join(
                        state.outputDirectory,
                        `${record.kind}.heapsnapshot`
                    );
                    const snapshot = await record.worker.getHeapSnapshot();
                    await streamPromises.pipeline(
                        snapshot,
                        fs.createWriteStream(record.snapshotPath)
                    );
                    const postSnapshot =
                        await record.worker.getHeapStatistics?.();
                    record.postGcHeapUsed = Number(
                        postSnapshot?.used_heap_size ?? 0
                    );
                }
                record.finalized = true;
            })().catch((error: unknown) => {
                recordTimeline({
                    type: `worker-profile-error:${
                        error instanceof Error
                            ? error.message.slice(0, 160)
                            : String(error).slice(0, 160)
                    }`,
                });
                record.finalized = true;
            });
            return record.finalizing;
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
            const markTerminated = (code: number): number => {
                record.terminatedEpochMs = nowEpochMs();
                record.finalized = true;
                recordTimeline({
                    operationId: record.operationId ?? undefined,
                    playlistId: record.playlistId ?? undefined,
                    type: `${record.kind}-terminated`,
                });
                return code;
            };
            if (!state.diagnostic) {
                if (record.sampleTimer) {
                    clearInterval(record.sampleTimer);
                    record.sampleTimer = null;
                }
                return originalTerminate.call(this).then(markTerminated);
            }
            return finalizeWorker(record)
                .then(() => originalTerminate.call(this))
                .then(markTerminated);
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
            for (const metric of app.getAppMetrics()) {
                const type = String(metric.type).toLowerCase();
                if (type.includes('tab') || type.includes('renderer')) {
                    state.rendererPeakRss = Math.max(
                        state.rendererPeakRss,
                        Number(metric.memory?.workingSetSize ?? 0) * 1024
                    );
                }
            }
        };
        const attachWindowListeners = (): void => {
            for (const window of BrowserWindow.getAllWindows()) {
                const unresponsive = () => {
                    state.unresponsiveEvents += 1;
                };
                const responsive = () => {
                    state.responsiveEvents += 1;
                };
                window.on('unresponsive', unresponsive);
                window.on('responsive', responsive);
                state.windowListeners.push({
                    responsive,
                    unresponsive,
                    window,
                });
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
                state.rendererPeakRss = 0;
                state.postGcHeap = null;
                state.postGcRss = null;
                state.unresponsiveEvents = 0;
                state.responsiveEvents = 0;
                state.cpuStart = process.cpuUsage();
                state.eventLoopStart =
                    perfHooks.performance.eventLoopUtilization();
                state.eventLoopDelay = perfHooks.monitorEventLoopDelay({
                    resolution: 1,
                });
                state.eventLoopDelay.enable();
                attachWindowListeners();
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
            },
            stop: async (): Promise<MainCaptureGenerationTransport> => {
                if (state.sampleTimer) {
                    clearInterval(state.sampleTimer);
                    state.sampleTimer = null;
                }
                state.eventLoopDelay?.disable();
                sampleMain();
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
                const databaseRecords = [...records.values()].filter(
                    (record) =>
                        record.captureGeneration === state.captureGeneration &&
                        record.kind === 'database.worker' &&
                        record.sampleTimer !== null
                );
                await Promise.all(
                    databaseRecords.map((record) => finalizeWorker(record))
                );
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
                for (const listener of state.windowListeners) {
                    listener.window.off('unresponsive', listener.unresponsive);
                    listener.window.off('responsive', listener.responsive);
                }
                state.windowListeners = [];
                state.active = false;
                databaseRequestIdentityCapture.stop();

                const workers = [...records.values()]
                    .filter(
                        (record) =>
                            record.kind === 'playlist-refresh.worker' ||
                            record.heapPeak > 0 ||
                            record.requestPerformance.length > 0
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
                            peakExternalBytes: record.externalPeak,
                            peakHeapUsedBytes: record.heapPeak,
                            playlistId: record.playlistId,
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
                return {
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
                        rendererPeakRssBytes: state.rendererPeakRss,
                        responsiveEvents: state.responsiveEvents,
                        rssScope:
                            'electron-main-process-including-worker-threads-and-native-memory',
                        timeline: state.timeline,
                        unresponsiveEvents: state.unresponsiveEvents,
                    },
                    workers,
                };
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

export async function stopMainCapture(
    electronApp: ElectronApplication
): Promise<MainCaptureMetrics> {
    const transport = await electronApp.evaluate(
        async (_electron, stateKey) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const api = target[stateKey] as {
                stop(): Promise<MainCaptureGenerationTransport>;
            };
            return api.stop();
        },
        MAIN_CAPTURE_STATE_KEY
    );
    return selectMainCaptureGeneration(transport);
}
