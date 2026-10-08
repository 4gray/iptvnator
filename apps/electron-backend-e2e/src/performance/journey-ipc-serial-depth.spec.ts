import assert from 'node:assert/strict';
import test from 'node:test';

import {
    computeJourneyIpcSerialDepth,
    type JourneyIpcTimelineEvent,
} from './journey-ipc-serial-depth';

/** `+name` starts a call of `name`, `-name` completes one. */
function timeline(...events: string[]): JourneyIpcTimelineEvent[] {
    return events.map((event) => ({
        method: event.slice(1),
        phase: event.startsWith('+') ? 'start' : 'end',
    }));
}

test('an empty timeline has depth 0', () => {
    assert.deepEqual(computeJourneyIpcSerialDepth([]), {
        chain: [],
        depth: 0,
        depthLowerBound: 0,
        inFlightAtEnd: 0,
    });
});

test('parallel calls count as one level', () => {
    const result = computeJourneyIpcSerialDepth(
        timeline('+a', '+b', '+c', '-b', '-a', '-c')
    );
    assert.equal(result.depth, 1);
    assert.equal(result.depthLowerBound, 1);
    assert.deepEqual(result.chain, ['c']);
});

test('each call that starts after a completion adds a level', () => {
    const result = computeJourneyIpcSerialDepth(
        timeline('+a', '-a', '+b', '-b', '+c', '-c')
    );
    assert.equal(result.depth, 3);
    assert.deepEqual(result.chain, ['a', 'b', 'c']);
});

test('a call started before an earlier call completed does not chain on it', () => {
    // b starts while a is in flight, so b is level 1 even though it ends later.
    const result = computeJourneyIpcSerialDepth(
        timeline('+a', '+b', '-a', '+c', '-b', '-c')
    );
    assert.equal(result.depth, 2);
    assert.deepEqual(result.chain, ['a', 'c']);
});

test('the longest chain wins over a later but shallower one', () => {
    const result = computeJourneyIpcSerialDepth(
        timeline(
            '+a',
            '+x',
            '-a',
            '+b',
            '-b',
            '+c',
            '-c',
            // x resolves last but only ever was level 1.
            '-x'
        )
    );
    assert.equal(result.depth, 3);
    assert.deepEqual(result.chain, ['a', 'b', 'c']);
});

test('calls still in flight at the end are excluded', () => {
    const result = computeJourneyIpcSerialDepth(
        timeline('+a', '-a', '+b', '-b', '+c', '+d')
    );
    assert.equal(result.depth, 2);
    assert.equal(result.inFlightAtEnd, 2);
    assert.deepEqual(result.chain, ['a', 'b']);
});

test('the chain names the latest completion at the deepest level', () => {
    const result = computeJourneyIpcSerialDepth(
        timeline('+a', '+b', '-a', '-b', '+c', '-c')
    );
    assert.deepEqual(result.chain, ['b', 'c']);
});

test('the J1 startup shape measures the recovery chain', () => {
    // Shape of the 2026-09-30 macOS trace on master.
    const result = computeJourneyIpcSerialDepth(
        timeline(
            '+announcePlaylistOpenListener',
            '+dbGetAppState',
            '+dbGetAppState',
            '+dbGetAppState',
            '+getAppUpdateStatus',
            '-announcePlaylistOpenListener',
            '-getAppUpdateStatus',
            '-dbGetAppState',
            '-dbGetAppState',
            '-dbGetAppState',
            '+dbRecoverLegacyPlaylists',
            '-dbRecoverLegacyPlaylists',
            '+dbGetAppState',
            '-dbGetAppState',
            '+dbGetAppPlaylistMetas',
            '-dbGetAppPlaylistMetas',
            '+reconcileEpgSources',
            '-reconcileEpgSources',
            '+setParentalLockState',
            '-setParentalLockState',
            '+downloadsGetList',
            '+dbGetRecentlyViewed'
        )
    );
    assert.equal(result.depth, 6);
    assert.equal(result.depthLowerBound, 6);
    assert.equal(result.inFlightAtEnd, 2);
    assert.deepEqual(result.chain, [
        'dbGetAppState',
        'dbRecoverLegacyPlaylists',
        'dbGetAppState',
        'dbGetAppPlaylistMetas',
        'reconcileEpgSources',
        'setParentalLockState',
    ]);
});

test('concurrent calls of one method at different depths give bounds', () => {
    // Two `a` calls are in flight at depths 1 and 2; which one completes
    // first is unknown, and only the deeper one would put `c` at depth 3.
    const events = timeline('+a', '+b', '-b', '+a', '-a', '+c', '-c', '-a');
    const result = computeJourneyIpcSerialDepth(events);
    assert.equal(result.depth, 3);
    assert.equal(result.depthLowerBound, 2);
    assert.deepEqual(result.chain, ['b', 'a', 'c']);
});

test('synchronous calls chain like any other bridge call', () => {
    // The preload emits a sync call's completion right after its start.
    const result = computeJourneyIpcSerialDepth(
        timeline('+a', '-a', '+sync', '-sync', '+b', '-b')
    );
    assert.equal(result.depth, 3);
});

test('a completion without a start fails the measurement', () => {
    assert.throws(
        () => computeJourneyIpcSerialDepth(timeline('+a', '-b')),
        /journey-ipc-serial-depth-unmatched-end:b/
    );
});
