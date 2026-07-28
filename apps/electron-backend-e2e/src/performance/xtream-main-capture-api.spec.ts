import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ElectronApplication } from '@playwright/test';

import {
    readXtreamMainCaptureStatus,
    rolloverXtreamMainCapture,
    stopXtreamMainCapture,
    type XtreamMainCaptureTransport,
} from './m3u-refresh-main-capture';

const STATE_KEY = '__iptvnatorM3uRefreshMainCapture';
const target = globalThis as unknown as Record<string, unknown>;

function electronApp(): ElectronApplication {
    return {
        evaluate: async (
            callback: (...args: never[]) => unknown,
            input: never
        ) => callback({} as never, input),
    } as unknown as ElectronApplication;
}

function electronAppRejectingAsyncEvaluation(): ElectronApplication {
    return {
        evaluate: (callback: (...args: never[]) => unknown, input: never) => {
            const result = callback({} as never, input);
            if (result instanceof Promise) {
                return Promise.reject(
                    new Error('async-main-evaluator-not-allowed')
                );
            }
            return Promise.resolve(result);
        },
    } as unknown as ElectronApplication;
}

function transport(
    overrides: Partial<XtreamMainCaptureTransport> = {}
): XtreamMainCaptureTransport {
    return {
        captureGeneration: 7,
        metrics: {
            cpuProfilePath: null,
            cpuSystemMicros: 11,
            cpuUserMicros: 13,
            eventLoopDelay: { maxMs: 3, p95Ms: 1, p99Ms: 2 },
            eventLoopUtilization: null,
            eventLoopUtilizationUnavailableReason:
                'electron-main-embedded-event-loop',
            heapSnapshotPath: null,
            memory: {
                peakHeapUsedBytes: 100,
                peakRssBytes: 200,
                postGcHeapUsedBytes: 80,
                postGcRssBytes: 160,
            },
            rendererWindow: {
                responsiveEvents: 0,
                rss: {
                    identity: { creationTime: 1_000, pid: 44 },
                    missingSampleCount: 0,
                    peakRssBytes: 90,
                    unavailableReason: null,
                    validSampleCount: 1,
                },
                unresponsiveEvents: 0,
                windowIdentity: {
                    browserWindowId: 2,
                    webContentsId: 3,
                },
            },
            rssScope:
                'electron-main-process-including-worker-threads-and-native-memory',
            timeline: [],
        },
        rollover: null,
        workers: [
            {
                captureGeneration: 7,
                metrics: {
                    cancelPostedEpochMs: null,
                    cpuSystemMicros: 5,
                    cpuUserMicros: 8,
                    eventLoopUtilization: 0.2,
                    externalMemorySampleCount: 1,
                    heapUsedSampleCount: 1,
                    kind: 'database.worker',
                    operationId: null,
                    ordinal: 1,
                    peakExternalBytes: 20,
                    peakExternalUnavailableReason: null,
                    peakHeapUsedBytes: 40,
                    peakHeapUsedUnavailableReason: null,
                    playlistId: null,
                    postGcHeapUnavailableReason: null,
                    postGcHeapUsedBytes: 30,
                    profilePath: null,
                    responseEpochMs: null,
                    snapshotPath: null,
                    terminatedEpochMs: null,
                },
                requests: [
                    {
                        ipcCallId: 5,
                        operation: 'DB_DELETE_XTREAM_CONTENT',
                        operationId: 'operation-1',
                        operationIdUnavailableReason: null,
                        performanceCapture: null,
                        playlistId: 'playlist-1',
                        requestId: 'request-1',
                        responseEpochMs: 180,
                        sourceEpochMs: 110,
                        success: true,
                    },
                ],
            },
        ],
        xtream: {
            cancelCapture: {
                invalidReasons: [],
                timeline: [],
            },
            captureCutoffEpochMs: 190,
            captureGeneration: 7,
            captureStartedEpochMs: 100,
            captureStoppedEpochMs: 220,
            databaseWorkerCount: 1,
            invalidReasons: [],
            ipcCapture: {
                invalidReasons: [],
                quarantinedKeyCount: 0,
                timeline: [],
            },
            lateDatabaseRequestCount: 0,
            lateEventCount: 0,
            measurementStartedEpochMs: 105,
            operationOutcomes: [
                {
                    count: 1,
                    operation: 'DB_DELETE_XTREAM_CONTENT',
                    outcome: 'success',
                },
            ],
            playlistRefreshWorkerCount: 0,
        },
        ...overrides,
    };
}

afterEach(() => delete target[STATE_KEY]);

describe('Xtream main capture API', () => {
    it('reads live status through a synchronous main evaluator', async () => {
        target[STATE_KEY] = {
            xtreamStatus: () => ({
                active: true,
                activeOperations: [],
                captureGeneration: 7,
                captureStartedEpochMs: 100,
                cutoffPhase: 'active',
                databaseWorkerCount: 1,
                invalidReasons: [],
                lateDatabaseRequestCount: 0,
                lateEventCount: 0,
                measurementPhase: 'measuring',
                measurementStartedEpochMs: 105,
                operationOutcomes: [],
                playlistRefreshWorkerCount: 0,
            }),
        };

        const status = await readXtreamMainCaptureStatus(
            electronAppRejectingAsyncEvaluation()
        );

        assert.equal(status.captureGeneration, 7);
    });

    it('returns live generation, exact active DB operation, and progress', async () => {
        target[STATE_KEY] = {
            xtreamStatus: () => ({
                active: true,
                activeOperations: [
                    {
                        operation: 'DB_DELETE_XTREAM_CONTENT',
                        operationId: 'operation-1',
                        playlistId: 'playlist-1',
                        progress: {
                            current: 250,
                            epochMs: 150,
                            phase: 'deleting-content',
                            status: 'progress',
                            total: 1_000,
                        },
                        requestId: 'request-1',
                    },
                ],
                captureGeneration: 7,
                captureStartedEpochMs: 100,
                cutoffPhase: 'active',
                databaseWorkerCount: 1,
                invalidReasons: [],
                lateDatabaseRequestCount: 0,
                lateEventCount: 0,
                measurementPhase: 'measuring',
                measurementStartedEpochMs: 105,
                operationOutcomes: [
                    {
                        count: 1,
                        operation: 'DB_DELETE_XTREAM_CONTENT',
                        outcome: 'pending',
                    },
                ],
                playlistRefreshWorkerCount: 0,
            }),
        };

        const status = await readXtreamMainCaptureStatus(electronApp());

        assert.equal(status.captureGeneration, 7);
        assert.equal(
            status.activeOperations[0]?.operation,
            'DB_DELETE_XTREAM_CONTENT'
        );
        assert.equal(status.activeOperations[0]?.progress?.current, 250);
        assert.deepEqual(status.operationOutcomes, [
            {
                count: 1,
                operation: 'DB_DELETE_XTREAM_CONTENT',
                outcome: 'pending',
            },
        ]);
    });

    it('keeps completed generation and cutoff evidence across rollover', async () => {
        target[STATE_KEY] = {
            stop: () =>
                transport({
                    rollover: {
                        nextCaptureStarted: true,
                        nextCaptureUnavailableReason: null,
                    },
                }),
        };

        const result = await rolloverXtreamMainCapture(electronApp(), {
            diagnostic: false,
            outputDirectory: '/tmp/synthetic-performance',
            rendererWindowIdentity: {
                browserWindowId: 2,
                webContentsId: 3,
            },
        });

        assert.equal(result.captureGeneration, 7);
        assert.equal(result.captureStartedEpochMs, 100);
        assert.equal(result.captureCutoffEpochMs, 190);
        assert.equal(result.captureStoppedEpochMs, 220);
        assert.equal(result.rollover?.nextCaptureStarted, true);
        assert.equal(result.databaseWorkerCount, 1);
        assert.equal(result.playlistRefreshWorkerCount, 0);
        assert.equal(result.quarantinedIpcMarkerCount, 0);
        assert.equal(result.workers.length, 1);
        assert.equal(result.requests.length, 1);
    });

    it('fails closed when the stop generation is missing or inconsistent', async () => {
        for (const invalid of [
            transport({ captureGeneration: 0 }),
            transport({
                xtream: {
                    ...transport().xtream,
                    captureGeneration: 8,
                },
            }),
        ]) {
            target[STATE_KEY] = { stop: () => invalid };
            await assert.rejects(
                stopXtreamMainCapture(electronApp()),
                /xtream-main-capture-transport-invalid/
            );
        }
    });

    it('fails closed on unknown IPC and cancel timeline labels', async () => {
        for (const invalid of [
            transport({
                xtream: {
                    ...transport().xtream,
                    ipcCapture: {
                        invalidReasons: [],
                        quarantinedKeyCount: 0,
                        timeline: [{ epochMs: 120, type: 'unknown-ipc-label' }],
                    } as never,
                },
            }),
            transport({
                xtream: {
                    ...transport().xtream,
                    cancelCapture: {
                        invalidReasons: [],
                        timeline: [
                            { epochMs: 130, type: 'unknown-cancel-label' },
                        ],
                    } as never,
                },
            }),
        ]) {
            target[STATE_KEY] = { stop: () => invalid };
            await assert.rejects(
                stopXtreamMainCapture(electronApp()),
                /xtream-main-capture-transport-invalid/
            );
        }
    });

    it('fails closed when operation outcomes disagree with request evidence', async () => {
        target[STATE_KEY] = {
            stop: () =>
                transport({
                    xtream: {
                        ...transport().xtream,
                        operationOutcomes: [
                            {
                                count: 2,
                                operation: 'DB_DELETE_XTREAM_CONTENT',
                                outcome: 'success',
                            },
                        ],
                    },
                }),
        };

        await assert.rejects(
            stopXtreamMainCapture(electronApp()),
            /xtream-main-capture-transport-invalid/
        );
    });
});
