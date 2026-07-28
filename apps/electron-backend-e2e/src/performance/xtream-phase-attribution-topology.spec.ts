import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    attributeXtreamPhases,
    XTREAM_ATTRIBUTION_PHASE as PHASE,
} from './xtream-phase-attribution';
import { scenarioCapture } from './xtream-phase-attribution.fixtures';
import { XTREAM_SCENARIO_ID } from './xtream-benchmark-contract';

describe('Xtream phase attribution topology', () => {
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
                ...refresh,
                events: movePair(
                    refresh.events,
                    PHASE.STORE_PUBLISH_CATEGORIES,
                    'store-categories-route',
                    phaseStart(
                        refresh,
                        PHASE.STORE_IMPORT_TERMINAL,
                        'store-terminal'
                    ) - 2
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
