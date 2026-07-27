/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWorkerPerformancePhaseEvents } from './worker-performance-phase-events';
import { parseXtreamWorkerPerformancePhaseEvents } from './xtream-worker-phase-events';

function phasePair(
    phase: string,
    startEpochMs: number,
    durationMs: number,
    requestId = 'request-1'
) {
    return [
        {
            boundary: 'start',
            durationMs: null,
            epochMs: startEpochMs,
            phase,
            requestId,
        },
        {
            boundary: 'end',
            durationMs,
            epochMs: startEpochMs + 1,
            metadata: { itemCount: 1 },
            phase,
            requestId,
        },
    ];
}

test('accepts producer-shaped worker output when separately read clocks have a wider monotonic duration', () => {
    const events = phasePair('sqlite.categories.read', 11, 1.6115);
    const parsed = parseXtreamWorkerPerformancePhaseEvents(
        'DB_GET_CATEGORIES',
        events,
        10,
        30,
        true
    );
    assert.deepEqual(parsed, events);
    assert.equal(Number(events[1]?.epochMs) - Number(events[0]?.epochMs), 1);
});

test('rejects an Xtream worker duration outside its request envelope', () => {
    assert.equal(
        parseXtreamWorkerPerformancePhaseEvents(
            'DB_GET_CATEGORIES',
            phasePair('sqlite.categories.read', 11, 999),
            10,
            30,
            true
        ),
        null
    );
});

test('rejects an out-of-envelope duration in a failed partial DB_SAVE_CONTENT capture', () => {
    const events = [
        ...phasePair('sqlite.content.category-map-read', 11, 1),
        ...phasePair('normalize.content', 13, 999),
    ];

    assert.equal(
        parseXtreamWorkerPerformancePhaseEvents(
            'DB_SAVE_CONTENT',
            events,
            10,
            30,
            false
        ),
        null
    );
});

test('accepts cross-clock skew but rejects an app-playlist duration outside the request envelope', () => {
    const producerShaped = [
        ...phasePair('sqlite.read', 11, 1.6115),
        ...phasePair('deserialize.playlist', 13, 1),
    ];
    assert.deepEqual(
        parseWorkerPerformancePhaseEvents(
            'DB_GET_APP_PLAYLIST',
            producerShaped,
            10,
            30,
            true
        ),
        producerShaped
    );

    const outsideEnvelope = [
        ...phasePair('sqlite.read', 11, 20.001),
        ...phasePair('deserialize.playlist', 13, 1),
    ];
    assert.equal(
        parseWorkerPerformancePhaseEvents(
            'DB_GET_APP_PLAYLIST',
            outsideEnvelope,
            10,
            30,
            true
        ),
        null
    );
});
