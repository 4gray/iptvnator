import assert from 'node:assert/strict';
import test from 'node:test';

import type { JourneyMainIpcCaptureState } from './journey-main-ipc-capture';
import { summarizeJourneyIterations } from './journey-summary';
import type { SearchJourneyProbeState } from './search-journey-probe';
import {
    SEARCH_JOURNEY_COUNTER,
    SEARCH_JOURNEY_UNAVAILABLE_COUNTERS,
    SEARCH_JOURNEY_WALL_CLOCK,
    toSearchIterationRecord,
    type SearchJourneyActivitySample,
    type SearchJourneyMeasurement,
} from './search-journey-record';

const QUERY = 'system';

function sample(
    ipcCalls: number,
    queryCalls: number,
    sqlStatements: number
): SearchJourneyActivitySample {
    return { ipcCalls, queryCalls, sqlStatements };
}

/** The shape of a debounced search: only the last key runs a query. */
function measurement(
    overrides: Partial<SearchJourneyMeasurement> = {},
    rendererOverrides: Partial<SearchJourneyProbeState> = {}
): SearchJourneyMeasurement {
    const keystrokes = [...QUERY].map((key, position) => ({
        epochMs: 10_000 + position * 100,
        key,
        ticks: 40 + position,
    }));
    const renderer: SearchJourneyProbeState = {
        capabilities: {
            changeDetectionTicks: 'counted',
            layoutShift: true,
            longTask: true,
        },
        counters: {
            domMutations: 402,
            layoutShiftScore: 0.0004,
            longTasks: 0,
            recentInputLayoutShiftScore: 0.0011,
        },
        domMutationsByKeystroke: [0, 0, 0, 0, 0, 402],
        final: true,
        firstResult: { cardCount: 100, epochMs: 11_180, query: QUERY },
        invalidReasons: [],
        keystrokes,
        longTaskDurationsMs: [],
        preStart: { domMutations: 5, lastMutationEpochMs: 8_000 },
        schemaVersion: 1,
        sentinel: { epochMs: 11_400, status: 'sent' },
        settle: {
            cardCount: 100,
            confirmedEpochMs: 11_399.6,
            epochMs: 11_192.54,
            query: QUERY,
            status: 'quiet',
            ticks: 54,
        },
        start: {
            epochMs: 10_000,
            pathname: '/w/search',
            sentinelStatus: 'sent',
        },
        ...rendererOverrides,
    };
    const ipc: JourneyMainIpcCaptureState = {
        ambiguousTimelineCompletions: 0,
        callsAfterSentinel: 0,
        callsBeforeStart: 0,
        callsBeforeSentinel: 1,
        callsByMethod: { dbGlobalSearch: 1 },
        inFlightByMethod: {},
        installedEpochMs: 9_000,
        malformedEvents: 0,
        processStartEpochMs: 1_000,
        senderIds: [1],
        sentinel: { occurrences: 1, receivedEpochMs: 11_401 },
        start: { occurrences: 1, receivedEpochMs: 10_001 },
        timeline: [
            { method: 'dbGlobalSearch', phase: 'start' },
            { method: 'dbGlobalSearch', phase: 'end' },
        ],
        unmatchedCompletions: 0,
    };
    return {
        afterSettled: sample(1, 1, 121),
        afterSettledWindowMs: 500,
        externalArtworkCancelled: 42,
        ipc,
        keyDelayMs: 100,
        pid: 4242,
        query: QUERY,
        renderer,
        samples: [
            sample(0, 0, 119),
            sample(0, 0, 119),
            sample(0, 0, 119),
            sample(0, 0, 119),
            sample(0, 0, 119),
            sample(0, 0, 119),
            sample(1, 1, 121),
        ],
        settle: {
            preStartDomMutations: 5,
            preStartIpcCalls: 0,
            quietMs: 1_000,
            sqlStatements: 119,
            waitedMs: 1_226,
        },
        ...overrides,
    };
}

test('maps a settled search to exact counters and wall-clock', () => {
    const record = toSearchIterationRecord(1, false, measurement());
    assert.deepEqual(record.counters, {
        [SEARCH_JOURNEY_COUNTER.CD_TICKS]: 14,
        [SEARCH_JOURNEY_COUNTER.DOM_MUTATIONS]: 402,
        [SEARCH_JOURNEY_COUNTER.IPC_CALLS]: 1,
        [SEARCH_JOURNEY_COUNTER.IPC_SERIAL_DEPTH]: 1,
        [SEARCH_JOURNEY_COUNTER.LAYOUT_SHIFT_SCORE]: 0.002,
        [SEARCH_JOURNEY_COUNTER.LONG_TASKS]: 0,
        [SEARCH_JOURNEY_COUNTER.SQL_STATEMENTS]: 2,
    });
    assert.deepEqual(record.wallClock, {
        [SEARCH_JOURNEY_WALL_CLOCK.FIRST_KEYSTROKE_TO_FIRST_RESULT]: 1_180,
        [SEARCH_JOURNEY_WALL_CLOCK.LAST_KEYSTROKE_TO_SETTLED]: 692.5,
    });
    assert.equal(record.pid, 4242);
    assert.equal(record.warmup, false);
});

test('breaks every counter down by keystroke', () => {
    const record = toSearchIterationRecord(1, false, measurement());
    const perKeystroke = record.evidence['perKeystroke'] as {
        cdTicks: number;
        domMutations: number;
        ipcCalls: number;
        key: string;
        queryCalls: number;
        sqlStatements: number;
    }[];
    assert.deepEqual(
        perKeystroke.map((entry) => entry.key),
        [...QUERY]
    );
    assert.deepEqual(
        perKeystroke.map((entry) => entry.cdTicks),
        [1, 1, 1, 1, 1, 9]
    );
    assert.deepEqual(
        perKeystroke.map((entry) => entry.queryCalls),
        [0, 0, 0, 0, 0, 1]
    );
    assert.deepEqual(
        perKeystroke.map((entry) => entry.sqlStatements),
        [0, 0, 0, 0, 0, 2]
    );
    assert.deepEqual(
        perKeystroke.map((entry) => entry.domMutations),
        [0, 0, 0, 0, 0, 402]
    );
    assert.deepEqual(record.evidence['sqlStatementsAfterSettled'], {
        count: 0,
        windowMs: 500,
    });
    assert.deepEqual(record.evidence['ipcTimeline'], [
        '+dbGlobalSearch',
        '-dbGlobalSearch',
    ]);
});

test('a query per keystroke shows up per key, not only in the total', () => {
    const record = toSearchIterationRecord(
        1,
        false,
        measurement({
            samples: [
                sample(0, 0, 100),
                sample(0, 0, 100),
                sample(1, 1, 102),
                sample(2, 2, 104),
                sample(3, 3, 106),
                sample(4, 4, 108),
                sample(5, 5, 110),
            ],
            settle: {
                preStartDomMutations: 5,
                preStartIpcCalls: 0,
                quietMs: 1_000,
                sqlStatements: 100,
                waitedMs: 1_000,
            },
            ipc: {
                ...measurement().ipc,
                callsBeforeSentinel: 5,
                callsByMethod: { dbGlobalSearch: 5 },
            },
        })
    );
    assert.equal(record.counters[SEARCH_JOURNEY_COUNTER.IPC_CALLS], 5);
    assert.equal(record.counters[SEARCH_JOURNEY_COUNTER.SQL_STATEMENTS], 10);
    const perKeystroke = record.evidence['perKeystroke'] as {
        queryCalls: number;
    }[];
    assert.deepEqual(
        perKeystroke.map((entry) => entry.queryCalls),
        [0, 1, 1, 1, 1, 1]
    );
});

test('rejects iterations that did not measure a settled search', () => {
    const cases: [Partial<SearchJourneyProbeState>, RegExp][] = [
        [{ start: null }, /incomplete-probe/],
        [
            {
                settle: { ...measurement().renderer.settle, status: 'timeout' },
            },
            /incomplete-probe/,
        ],
        [
            { keystrokes: measurement().renderer.keystrokes.slice(1) },
            /keystroke-count/,
        ],
        [
            {
                keystrokes: measurement().renderer.keystrokes.map((key) => ({
                    ...key,
                    key: 'x',
                })),
            },
            /typed-text/,
        ],
        [
            { settle: { ...measurement().renderer.settle, query: 'syste' } },
            /no-results/,
        ],
        [{ firstResult: null }, /no-results/],
        [
            { settle: { ...measurement().renderer.settle, epochMs: 9_000 } },
            /clock-order/,
        ],
        [{ preStart: { domMutations: 6, lastMutationEpochMs: 9_990 } }, /dom/],
        [
            {
                capabilities: {
                    changeDetectionTicks: 'unavailable-counter-missing',
                    layoutShift: true,
                    longTask: true,
                },
            },
            /cd-ticks-unavailable-counter-missing/,
        ],
    ];
    for (const [overrides, error] of cases) {
        assert.throws(
            () => toSearchIterationRecord(1, false, measurement({}, overrides)),
            error
        );
    }
});

test('rejects work that moved between the quiet snapshot and the first key', () => {
    const base = measurement();
    assert.throws(
        () =>
            toSearchIterationRecord(
                1,
                false,
                measurement({ ipc: { ...base.ipc, callsBeforeStart: 1 } })
            ),
        /activity-before-first-key-ipc/
    );
    assert.throws(
        () =>
            toSearchIterationRecord(
                1,
                false,
                measurement({
                    samples: [sample(0, 0, 120), ...base.samples.slice(1)],
                })
            ),
        /activity-before-first-key-sql/
    );
    assert.throws(
        () =>
            toSearchIterationRecord(
                1,
                false,
                measurement({
                    samples: [...base.samples.slice(0, 6), sample(2, 1, 121)],
                })
            ),
        /ipc-sample-mismatch/
    );
});

test('summarizes with the shared summary and nothing unavailable', () => {
    const iterations = [0, 1, 2].map((index) =>
        toSearchIterationRecord(
            index,
            index === 0,
            measurement({ pid: 4_000 + index })
        )
    );
    const entry = summarizeJourneyIterations(
        iterations,
        SEARCH_JOURNEY_UNAVAILABLE_COUNTERS
    );
    assert.equal(entry.counters[SEARCH_JOURNEY_COUNTER.IPC_CALLS], 1);
    assert.equal(
        entry.counterStability[SEARCH_JOURNEY_COUNTER.SQL_STATEMENTS]?.stable,
        true
    );
    assert.equal(
        entry.wallClock[
            `${SEARCH_JOURNEY_WALL_CLOCK.LAST_KEYSTROKE_TO_SETTLED}.p50`
        ],
        692.5
    );
    assert.deepEqual(entry.unavailable, {});
});
