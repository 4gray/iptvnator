import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    attributeXtreamPhases,
    XTREAM_ATTRIBUTION_PHASE as PHASE,
} from './xtream-phase-attribution';
import {
    lastStoreEnd,
    pair,
    removePair,
    scenarioCapture,
} from './xtream-phase-attribution.fixtures';
import { XTREAM_SCENARIO_ID } from './xtream-benchmark-contract';

describe('Xtream phase attribution', () => {
    it('requires the exact scenario-specific worker, store, and IPC inventory', () => {
        for (const scenarioId of Object.values(XTREAM_SCENARIO_ID)) {
            const input = scenarioCapture(scenarioId);
            const result = attributeXtreamPhases(input);

            assert.equal(
                result.structuredCloneAttribution,
                'selected-ipc-proxy-includes-queueing-and-scheduling'
            );
            assert.equal(
                result.angularRenderingMs,
                input.uiPaintEpochMs - lastStoreEnd(input.events)
            );
            assert.ok(result.totalMs > 0);
            if (scenarioId === XTREAM_SCENARIO_ID.DELETE_LARGE) {
                assert.equal(result.dataAcquisitionMs, 0);
                assert.equal(result.jsonParsingMs, 0);
                assert.equal(result.normalizationMs, 0);
            } else {
                assert.ok(result.dataAcquisitionMs >= 0);
                assert.ok(result.jsonParsingMs >= 0);
                assert.ok(result.normalizationMs >= 0);
            }
        }
    });

    it('accepts parallel category completion as a multiset rather than temporal type order', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const originalStarts = new Map(
            initial.events
                .filter(({ boundary }) => boundary === 'start')
                .map(({ correlationId, epochMs, phase }) => [
                    `${phase}\0${correlationId}`,
                    epochMs,
                ])
        );
        const swappedRequests = new Map([
            ['category-save-0', 'category-save-1'],
            ['category-save-1', 'category-save-0'],
            ['category-read-0-post', 'category-read-1-post'],
            ['category-read-1-post', 'category-read-0-post'],
        ]);
        const events = initial.events.map((event) => {
            const swappedRequest = swappedRequests.get(event.correlationId);
            const start =
                swappedRequest === undefined
                    ? undefined
                    : originalStarts.get(`${event.phase}\0${swappedRequest}`);
            return start === undefined
                ? event
                : {
                      ...event,
                      epochMs:
                          start +
                          (event.boundary === 'end'
                              ? Number(event.durationMs)
                              : 0),
                  };
        });

        assert.doesNotThrow(() =>
            attributeXtreamPhases({ ...initial, events })
        );
    });

    it('includes the route playlist read in every selected IPC inventory', () => {
        const expectedReads = new Map([
            [XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE, 1],
            [XTREAM_SCENARIO_ID.REFRESH_LARGE, 2],
            [XTREAM_SCENARIO_ID.DELETE_LARGE, 0],
            [XTREAM_SCENARIO_ID.CANCEL_IMPORT, 1],
            [XTREAM_SCENARIO_ID.BACKGROUND_UI, 2],
        ]);
        for (const [scenarioId, expected] of expectedReads) {
            const requests = scenarioCapture(scenarioId).ipcSpans.filter(
                ({ boundary, method }) =>
                    boundary === 'request' && method === 'dbGetAppPlaylist'
            );
            assert.equal(requests.length, expected);
        }
    });

    it('rejects impossible store, refresh, cancel-cleanup, and double-delete topology', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const refresh = scenarioCapture(XTREAM_SCENARIO_ID.REFRESH_LARGE);
        const cancel = scenarioCapture(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const deletion = scenarioCapture(XTREAM_SCENARIO_ID.DELETE_LARGE);
        const phaseStart = (
            capture: typeof initial,
            phase: string,
            correlationId: string
        ) =>
            Number(
                capture.events.find(
                    (event) =>
                        event.boundary === 'start' &&
                        event.phase === phase &&
                        event.correlationId === correlationId
                )?.epochMs
            );
        const candidates = [
            {
                ...initial,
                events: movePair(
                    initial.events,
                    PHASE.STORE_IMPORT_TERMINAL,
                    'store-terminal',
                    102
                ),
            },
            {
                ...initial,
                events: movePair(
                    initial.events,
                    PHASE.STORE_PUBLISH_LIVE,
                    'store-live',
                    phaseStart(initial, PHASE.STORE_PUBLISH_VOD, 'store-vod') +
                        2
                ),
            },
            {
                ...refresh,
                events: movePair(
                    refresh.events,
                    PHASE.STORE_REFRESH_META,
                    'refresh-meta',
                    refresh.terminalEpochMs - 3
                ),
                uiPaintEpochMs: refresh.terminalEpochMs - 1,
            },
            {
                ...refresh,
                events: movePair(
                    refresh.events,
                    PHASE.STORE_REFRESH_META,
                    'refresh-meta',
                    phaseStart(
                        refresh,
                        PHASE.SQLITE_XTREAM_DELETE_COLLECT_USER_DATA,
                        'refresh-delete'
                    )
                ),
            },
            {
                ...cancel,
                events: movePair(
                    cancel.events,
                    PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
                    'cache-clear-live',
                    102
                ),
            },
            {
                ...cancel,
                events: movePair(
                    cancel.events,
                    PHASE.CANCEL_SESSION,
                    'cancel-session',
                    phaseStart(
                        cancel,
                        PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
                        'content-save-live'
                    ) - 2
                ),
            },
            {
                ...deletion,
                events: movePair(
                    deletion.events,
                    PHASE.STORE_DELETE_ROW,
                    'delete-store',
                    102
                ),
                uiPaintEpochMs: deletion.terminalEpochMs - 1,
            },
        ];

        for (const candidate of candidates) {
            assert.throws(
                () => attributeXtreamPhases(candidate),
                /invalid Xtream phase capture/
            );
        }
    });

    it('rejects missing, extra, or mislabeled phases and IPC pairs', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const missingNormalization = removePair(
            initial.events,
            PHASE.NORMALIZE_CONTENT,
            'content-save-2'
        );
        const missingIpcResponse = initial.ipcSpans.slice(0, -1);
        const wrongIpcMethod = initial.ipcSpans.map((span, index) =>
            index === 0 ? { ...span, method: 'dbSearchContent' } : span
        );
        const extraStore = [
            ...initial.events,
            ...pair(PHASE.STORE_PUBLISH_LIVE, 'extra-live', 900, 1, 1),
        ];
        const numericPhaseCorrelation = initial.events.map((event) =>
            event.phase === PHASE.NORMALIZE_CONTENT &&
            event.correlationId === 'content-save-2'
                ? { ...event, correlationId: 7 as unknown as string }
                : event
        );
        const numericIpcCorrelation = initial.ipcSpans.map((span) =>
            span.correlationId === 'dbGetCategories-0'
                ? { ...span, correlationId: 7 as unknown as string }
                : span
        );

        for (const candidate of [
            { ...initial, events: missingNormalization },
            { ...initial, ipcSpans: missingIpcResponse },
            { ...initial, ipcSpans: wrongIpcMethod },
            { ...initial, events: extraStore },
            { ...initial, events: numericPhaseCorrelation },
            { ...initial, ipcSpans: numericIpcCorrelation },
            {
                ...initial,
                uiPaintEpochMs: initial.terminalEpochMs + 1,
            },
            {
                ...initial,
                scenarioId: 'xtream-unknown' as typeof initial.scenarioId,
            },
            {
                ...initial,
                backgroundSearchMarkerObserved: 'false' as unknown as boolean,
            },
        ]) {
            assert.throws(
                () => attributeXtreamPhases(candidate),
                /invalid Xtream phase capture/
            );
        }
    });

    it('requires the exact cancel prefix, cleanup, and unsuccessful live write', () => {
        const cancel = scenarioCapture(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const liveWrite = cancel.events.findIndex(
            (event) =>
                event.phase === PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS &&
                event.boundary === 'end'
        );
        const withSuccessfulWrite = cancel.events.map((event, index) =>
            index === liveWrite ? { ...event, itemCount: 60_000 } : event
        );
        const missingCacheClear = removePair(
            cancel.events,
            PHASE.SQLITE_XTREAM_CACHE_CLEAR_WRITE_TRANSACTIONS,
            'cache-clear-live'
        );
        const misorderedCacheClear = cancel.events.map((event) => {
            if (event.boundary !== 'end') return event;
            if (event.correlationId === 'cache-clear-live') {
                return { ...event, itemCount: 20 };
            }
            if (event.correlationId === 'cache-clear-movie') {
                return { ...event, itemCount: 6_060 };
            }
            return event;
        });

        assert.throws(
            () =>
                attributeXtreamPhases({
                    ...cancel,
                    events: withSuccessfulWrite,
                }),
            /invalid Xtream phase capture/
        );
        assert.throws(
            () =>
                attributeXtreamPhases({
                    ...cancel,
                    events: missingCacheClear,
                }),
            /invalid Xtream phase capture/
        );
        assert.throws(
            () =>
                attributeXtreamPhases({
                    ...cancel,
                    events: misorderedCacheClear,
                }),
            /invalid Xtream phase capture/
        );
    });

    it('keeps first visible store-to-paint separate from later delete settlement', () => {
        const deletion = scenarioCapture(XTREAM_SCENARIO_ID.DELETE_LARGE);

        assert.ok(deletion.uiPaintEpochMs < deletion.terminalEpochMs);
        const result = attributeXtreamPhases(deletion);
        assert.equal(
            result.angularRenderingMs,
            deletion.uiPaintEpochMs - lastStoreEnd(deletion.events)
        );
        assert.ok(result.totalMs > result.angularRenderingMs);
    });

    it('fails closed on unexpected Sources search instrumentation', () => {
        const background = scenarioCapture(XTREAM_SCENARIO_ID.BACKGROUND_UI);

        assert.throws(
            () =>
                attributeXtreamPhases({
                    ...background,
                    backgroundSearchMarkerObserved: true,
                }),
            /unexpected background search marker/
        );
        assert.throws(
            () =>
                attributeXtreamPhases({
                    ...background,
                    events: [
                        ...background.events,
                        ...pair(
                            PHASE.SQLITE_SEARCH_QUERY,
                            'unexpected-search',
                            900,
                            1,
                            1
                        ),
                    ],
                }),
            /invalid Xtream phase capture/
        );
    });
});

function movePair(
    events: ReturnType<typeof scenarioCapture>['events'],
    phase: string,
    correlationId: string,
    startEpochMs: number
) {
    return events.map((event) =>
        event.phase === phase && event.correlationId === correlationId
            ? {
                  ...event,
                  epochMs:
                      startEpochMs +
                      (event.boundary === 'end' ? Number(event.durationMs) : 0),
              }
            : event
    );
}
