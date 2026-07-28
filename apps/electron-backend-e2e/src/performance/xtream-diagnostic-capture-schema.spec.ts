import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    snapshotXtreamDiagnosticCapture,
    type XtreamDiagnosticWorkerArtifact,
} from './xtream-diagnostic-capture-schema';

const WORKER: XtreamDiagnosticWorkerArtifact = {
    kind: 'database.worker',
    ordinal: 4,
    profilePath: '/tmp/database.worker-4.cpuprofile',
    snapshotPath: '/tmp/database.worker-4.heapsnapshot',
};

describe('Xtream diagnostic capture schema', () => {
    it('reads a workers accessor once before validating and freezing it', () => {
        let reads = 0;
        const capture = {
            main: {
                cpuProfilePath: '/tmp/main.cpuprofile',
                heapSnapshotPath: '/tmp/main.heapsnapshot',
                get workers() {
                    reads += 1;
                    return [{ ...WORKER }];
                },
            },
            renderer: {
                cpuProfilePath: '/tmp/renderer.cpuprofile',
                heapSnapshotPath: '/tmp/renderer.heapsnapshot',
                tracePath: '/tmp/renderer.trace.json',
            },
        };

        const snapshot = snapshotXtreamDiagnosticCapture(capture);

        assert.equal(reads, 1);
        assert.deepEqual(snapshot.main.workers, [WORKER]);
        assert.ok(Object.isFrozen(snapshot.main.workers));
        assert.ok(Object.isFrozen(snapshot.main.workers[0]));
    });

    it('rejects the producer-impossible zero worker ordinal', () => {
        assert.throws(
            () =>
                snapshotXtreamDiagnosticCapture({
                    main: {
                        cpuProfilePath: '/tmp/main.cpuprofile',
                        heapSnapshotPath: '/tmp/main.heapsnapshot',
                        workers: [{ ...WORKER, ordinal: 0 }],
                    },
                    renderer: {
                        cpuProfilePath: '/tmp/renderer.cpuprofile',
                        heapSnapshotPath: '/tmp/renderer.heapsnapshot',
                        tracePath: '/tmp/renderer.trace.json',
                    },
                }),
            /xtream-diagnostic-capture-invalid/
        );
    });
});
