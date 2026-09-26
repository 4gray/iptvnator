import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assertJourneyMainCounters,
    JOURNEY_MAIN_COUNTER,
    JOURNEY_PERFORMANCE_COUNTERS_CHANNEL,
} from './journey-main-counters';

const gate = { gatedEpochMs: 1_020, releasedEpochMs: 1_150 };

function snapshot(
    counters: Record<string, number> = {},
    frozenAtEpochMs: Record<string, number> = {}
) {
    return {
        counters: {
            'main.modulesRegisteredBeforeWindow': 2,
            'main.sqlStatements': 40,
            'main.sqlStatementsBeforeReadyToShow': 12,
            'main.startupPhases': 9,
            ...counters,
        },
        frozenAtEpochMs: {
            'main.modulesRegisteredBeforeWindow': 1_010,
            'main.sqlStatementsBeforeReadyToShow': 1_300,
            ...frozenAtEpochMs,
        },
    };
}

test('mirrors the channel and counter names of the app', () => {
    assert.equal(
        JOURNEY_PERFORMANCE_COUNTERS_CHANNEL,
        'performance:read-counters'
    );
    assert.deepEqual(Object.values(JOURNEY_MAIN_COUNTER).sort(), [
        'main.modulesRegisteredBeforeWindow',
        'main.sqlStatements',
        'main.sqlStatementsBeforeReadyToShow',
        'main.startupPhases',
    ]);
});

test('accepts a snapshot frozen at window creation and after the release', () => {
    const value = snapshot();
    assert.deepEqual(assertJourneyMainCounters(value, gate), value);
});

test('accepts zero statements before ready-to-show with no running total', () => {
    const value = snapshot({ 'main.sqlStatementsBeforeReadyToShow': 0 });
    delete (value.counters as Record<string, number>)['main.sqlStatements'];
    assert.equal(
        assertJourneyMainCounters(value, gate).counters[
            'main.sqlStatementsBeforeReadyToShow'
        ],
        0
    );
});

test('rejects malformed or incomplete snapshots', () => {
    for (const value of [
        null,
        { counters: {} },
        { counters: { 'main.sqlStatements': -1 }, frozenAtEpochMs: {} },
        { counters: { 'main.sqlStatements': 1.5 }, frozenAtEpochMs: {} },
        { counters: [], frozenAtEpochMs: {} },
    ]) {
        assert.throws(
            () => assertJourneyMainCounters(value, gate),
            /malformed/
        );
    }
    const unfrozen = snapshot();
    delete (unfrozen.frozenAtEpochMs as Record<string, number>)[
        'main.sqlStatementsBeforeReadyToShow'
    ];
    assert.throws(
        () => assertJourneyMainCounters(unfrozen, gate),
        /not-frozen: main.sqlStatementsBeforeReadyToShow/
    );
    assert.throws(
        () =>
            assertJourneyMainCounters(snapshot(), {
                gatedEpochMs: null,
                releasedEpochMs: 1_150,
            }),
        /gate-incomplete/
    );
});

test('rejects snapshots that were not frozen at the moments they claim', () => {
    assert.throws(
        () =>
            assertJourneyMainCounters(
                snapshot({}, { 'main.modulesRegisteredBeforeWindow': 1_030 }),
                gate
            ),
        /window-after-first-load/
    );
    // ready-to-show of about:blank, before the real document was released.
    assert.throws(
        () =>
            assertJourneyMainCounters(
                snapshot({}, { 'main.sqlStatementsBeforeReadyToShow': 1_100 }),
                gate
            ),
        /ready-to-show-before-release/
    );
    assert.throws(
        () =>
            assertJourneyMainCounters(
                snapshot({ 'main.sqlStatements': 11 }),
                gate
            ),
        /total-below-frozen: main.sqlStatements/
    );
    assert.throws(
        () =>
            assertJourneyMainCounters(
                snapshot({ 'main.startupPhases': 1 }),
                gate
            ),
        /total-below-frozen: main.startupPhases/
    );
});
