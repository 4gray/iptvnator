import assert from 'node:assert/strict';
import test from 'node:test';

import { journeyLaunchEnvironment } from './journey-launch-environment';

test('J1 launches with the main-process counters and SQL counting', () => {
    assert.deepEqual(journeyLaunchEnvironment({ mainCounters: true }), {
        IPTVNATOR_PERF_CAPTURE: '1',
        IPTVNATOR_PERF_COUNT_SQL: '1',
        IPTVNATOR_TRACE_IPC: '1',
    });
});

test('a journey that does not read the main counters launches with the IPC trace only', () => {
    assert.deepEqual(journeyLaunchEnvironment({ mainCounters: false }), {
        IPTVNATOR_TRACE_IPC: '1',
    });
});
