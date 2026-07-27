import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MainCaptureMetrics } from './m3u-refresh-cancellation-contract';
import { deriveM3uImportPhaseMetrics } from './m3u-import-report';
import {
    createTestMainCapture,
    createTestRendererCapture,
    TEST_M3U_CHANNEL_COUNT,
    TEST_M3U_FIXTURE_BYTES,
} from './m3u-import-report.test-helpers';

describe('formal M3U import phase report', () => {
    it('attributes every required phase without presenting indexes as zero work', () => {
        const phases = deriveM3uImportPhaseMetrics({
            channelCount: TEST_M3U_CHANNEL_COUNT,
            fixtureBytes: TEST_M3U_FIXTURE_BYTES,
            main: createTestMainCapture(),
            renderer: createTestRendererCapture(),
        });

        assert.deepEqual(phases, {
            angularRenderingMs: 10,
            dataAcquireMs: 20,
            databaseWorkerToMainCloneProxyMs: 12,
            indexAndCommitMs: null,
            indexAndCommitUnavailableReason:
                'indexes-not-created-during-import;sqlite-autocommit-included-in-sqlite-write',
            ipcStructuredCloneProxyMs: 44,
            mainToDatabaseWorkerCloneProxyMs: 2,
            mainToRendererCloneProxyMs: 28,
            m3uParsingMs: 40,
            normalizationMs: 10,
            playlistDeserializationMs: 12,
            playlistSerializationMs: 20,
            rendererToMainCloneProxyMs: 2,
            sqliteReadMs: 5,
            sqliteWriteMs: 30,
            storeImportDispatchMs: 2,
            storePublishChannelsMs: 10,
            storeUpdateMs: 12,
            totalMs: 215,
        });
        assert.equal(
            phases.ipcStructuredCloneProxyMs,
            phases.mainToRendererCloneProxyMs +
                phases.rendererToMainCloneProxyMs +
                phases.mainToDatabaseWorkerCloneProxyMs +
                phases.databaseWorkerToMainCloneProxyMs
        );
    });

    it('fails closed when any structured-clone boundary is missing, ambiguous, or out of order', () => {
        const main = createTestMainCapture();
        const databaseWorker = main.workers[0];
        const upsert = databaseWorker?.requests[0];
        assert.ok(databaseWorker);
        assert.ok(upsert);

        for (const invalidMain of [
            {
                ...main,
                timeline: main.timeline.filter(
                    (event) => event.type !== 'db-request'
                ),
            },
            {
                ...main,
                timeline: [
                    ...main.timeline,
                    main.timeline.find((event) => event.type === 'db-request'),
                ].filter(
                    (event): event is (typeof main.timeline)[number] =>
                        event !== undefined
                ),
            },
            {
                ...main,
                workers: [
                    {
                        ...databaseWorker,
                        requests: [
                            {
                                ...upsert,
                                sourceEpochMs: 1080,
                            },
                            ...databaseWorker.requests.slice(1),
                        ],
                    },
                ],
            },
            {
                ...main,
                workers: [
                    {
                        ...databaseWorker,
                        requests: [
                            {
                                ...upsert,
                                requestReceivedEpochMs: 1078,
                            },
                            ...databaseWorker.requests.slice(1),
                        ],
                    },
                ],
            },
            {
                ...main,
                workers: [
                    {
                        ...databaseWorker,
                        requests: [
                            {
                                ...upsert,
                                ipcCallId: null,
                                operationIdUnavailableReason:
                                    'preload-performance-marker-missing',
                                sourceEpochMs: null,
                            },
                            ...databaseWorker.requests.slice(1),
                        ],
                    },
                ],
            },
            {
                ...main,
                workers: [
                    {
                        ...databaseWorker,
                        requests: [
                            {
                                ...upsert,
                                workStartedEpochMs: 1079,
                            },
                            ...databaseWorker.requests.slice(1),
                        ],
                    },
                ],
            },
        ]) {
            assert.throws(
                () =>
                    deriveM3uImportPhaseMetrics({
                        channelCount: TEST_M3U_CHANNEL_COUNT,
                        fixtureBytes: TEST_M3U_FIXTURE_BYTES,
                        main: invalidMain,
                        renderer: createTestRendererCapture(),
                    }),
                /m3u-import-phase-attribution-invalid/
            );
        }
    });

    it('fails closed when a required phase, worker identity, or fixture count is ambiguous', () => {
        const missingNormalize = createTestMainCapture();
        const missingTimeline = missingNormalize.timeline.filter(
            (event) => event.phase !== 'normalize'
        );
        assert.throws(
            () =>
                deriveM3uImportPhaseMetrics({
                    channelCount: TEST_M3U_CHANNEL_COUNT,
                    fixtureBytes: TEST_M3U_FIXTURE_BYTES,
                    main: {
                        ...missingNormalize,
                        timeline: missingTimeline,
                    },
                    renderer: createTestRendererCapture(),
                }),
            /m3u-import-phase-attribution-invalid/
        );

        assert.throws(
            () =>
                deriveM3uImportPhaseMetrics({
                    channelCount: TEST_M3U_CHANNEL_COUNT,
                    fixtureBytes: TEST_M3U_FIXTURE_BYTES,
                    main: {
                        ...createTestMainCapture(),
                        workers: [
                            ...createTestMainCapture().workers,
                            {
                                ...createTestMainCapture().workers[0],
                                ordinal: 2,
                            },
                        ],
                    },
                    renderer: createTestRendererCapture(),
                }),
            /m3u-import-phase-attribution-invalid/
        );

        const wrongBytes = createTestMainCapture();
        assert.throws(
            () =>
                deriveM3uImportPhaseMetrics({
                    channelCount: TEST_M3U_CHANNEL_COUNT,
                    fixtureBytes: TEST_M3U_FIXTURE_BYTES + 1,
                    main: wrongBytes,
                    renderer: createTestRendererCapture(),
                }),
            /m3u-import-phase-attribution-invalid/
        );
    });

    it('requires the route-reload GET and both worker-to-renderer return paths', () => {
        const main = createTestMainCapture();
        const databaseWorker = main.workers[0];
        const upsert = databaseWorker?.requests[0];
        const get = databaseWorker?.requests[1];
        assert.ok(databaseWorker);
        assert.ok(upsert);
        assert.ok(get);

        const invalidCaptures: MainCaptureMetrics[] = [
            {
                ...main,
                workers: [
                    {
                        ...databaseWorker,
                        requests: databaseWorker.requests.slice(0, 1),
                    },
                ],
            },
            {
                ...main,
                timeline: main.timeline.filter(
                    (event) =>
                        !(
                            event.type === 'preload-performance-success' &&
                            event.operation === 'DB_GET_APP_PLAYLIST'
                        )
                ),
            },
            {
                ...main,
                timeline: main.timeline.filter(
                    (event) =>
                        !(
                            event.type === 'preload-performance-success' &&
                            event.operation === 'DB_UPSERT_APP_PLAYLIST'
                        )
                ),
            },
            {
                ...main,
                timeline: main.timeline.map((event) =>
                    event.type === 'preload-performance-success' &&
                    event.operation === 'DB_GET_APP_PLAYLIST'
                        ? {
                              ...event,
                              sourceEpochMs: 1196,
                          }
                        : event
                ),
            },
            {
                ...main,
                workers: [
                    {
                        ...databaseWorker,
                        requests: [
                            upsert,
                            {
                                ...get,
                                responsePostedEpochMs: 1175,
                            },
                        ],
                    },
                ],
            },
        ];

        for (const invalidMain of invalidCaptures) {
            assert.throws(
                () =>
                    deriveM3uImportPhaseMetrics({
                        channelCount: TEST_M3U_CHANNEL_COUNT,
                        fixtureBytes: TEST_M3U_FIXTURE_BYTES,
                        main: invalidMain,
                        renderer: createTestRendererCapture(),
                    }),
                /m3u-import-phase-attribution-invalid/
            );
        }
    });

    it('rejects playlist workers and cross-playlist database writes', () => {
        assert.throws(
            () =>
                deriveM3uImportPhaseMetrics({
                    channelCount: TEST_M3U_CHANNEL_COUNT,
                    fixtureBytes: TEST_M3U_FIXTURE_BYTES,
                    main: {
                        ...createTestMainCapture(),
                        workers: [
                            ...createTestMainCapture().workers,
                            {
                                kind: 'playlist-refresh.worker',
                                requests: [],
                            },
                        ],
                    } as MainCaptureMetrics,
                    renderer: createTestRendererCapture(),
                }),
            /m3u-import-phase-attribution-invalid/
        );

        const main = createTestMainCapture();
        const databaseWorker = main.workers[0];
        assert.ok(databaseWorker);
        const upsert = databaseWorker.requests[0];
        assert.ok(upsert);
        assert.throws(
            () =>
                deriveM3uImportPhaseMetrics({
                    channelCount: TEST_M3U_CHANNEL_COUNT,
                    fixtureBytes: TEST_M3U_FIXTURE_BYTES,
                    main: {
                        ...main,
                        workers: [
                            {
                                ...databaseWorker,
                                requests: [
                                    {
                                        ...upsert,
                                        playlistId: 'other-playlist',
                                    },
                                ],
                            },
                        ],
                    },
                    renderer: createTestRendererCapture(),
                }),
            /m3u-import-phase-attribution-invalid/
        );
    });
});
