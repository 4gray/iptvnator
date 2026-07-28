import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { XTREAM_SCENARIO_ID } from './xtream-benchmark-contract';
import {
    invalidateWorkerRequestMetrics,
    workerRequestEvidence,
} from './xtream-worker-request-evidence.fixtures';
import { deriveXtreamWorkerRequestWindowProxy } from './xtream-worker-request-proxy';

describe('Xtream request-window proxy', () => {
    it('uses the worst valid request window and excludes only overlap-invalid samples', () => {
        const evidence = workerRequestEvidence(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        ).map((request, index) =>
            index === 1
                ? {
                      ...request,
                      eventLoopDelay: {
                          maxMs: 12,
                          p95Ms: 4,
                          p99Ms: 7,
                      },
                      eventLoopUtilization: 0.75,
                  }
                : request
        );
        const withOverlap = invalidateWorkerRequestMetrics(evidence, 1);

        assert.deepEqual(deriveXtreamWorkerRequestWindowProxy(withOverlap), {
            eventLoopDelayMaxMs: 12,
            eventLoopDelayP95Ms: 4,
            eventLoopDelayP99Ms: 7,
            eventLoopUtilization: 0.75,
        });
        assert.equal(
            deriveXtreamWorkerRequestWindowProxy(
                invalidateWorkerRequestMetrics(evidence, evidence.length)
            ),
            null
        );
    });
});
