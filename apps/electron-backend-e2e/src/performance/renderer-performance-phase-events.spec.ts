import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    pairRendererPerformancePhaseEvents,
    requireRendererPerformancePhase,
} from './renderer-performance-phase-events';

describe('renderer performance phase event pairing', () => {
    it('pairs a successful renderer phase using monotonic duration', () => {
        const phases = pairRendererPerformancePhaseEvents([
            {
                boundary: 'start',
                epochMs: 100,
                metadata: { items: 10_000 },
                monotonicMs: 20,
                phase: 'store.m3u-publish-channels',
                phaseId: 'phase-1',
                schemaVersion: 1,
            },
            {
                boundary: 'end',
                epochMs: 106,
                metadata: { items: 10_000 },
                monotonicMs: 25.5,
                outcome: 'success',
                phase: 'store.m3u-publish-channels',
                phaseId: 'phase-1',
                schemaVersion: 1,
            },
        ]);

        assert.deepEqual(phases, [
            {
                durationMs: 5.5,
                endedEpochMs: 106,
                metadata: { items: 10_000 },
                outcome: 'success',
                phase: 'store.m3u-publish-channels',
                phaseId: 'phase-1',
                startedEpochMs: 100,
            },
        ]);
        assert.deepEqual(
            requireRendererPerformancePhase(
                phases,
                'store.m3u-publish-channels'
            ),
            phases[0]
        );
    });

    it('fails closed for inconsistent identity, metadata, outcome, and clocks', () => {
        const start = {
            boundary: 'start',
            epochMs: 100,
            metadata: { items: 50_000 },
            monotonicMs: 20,
            phase: 'store.m3u-import-dispatch',
            phaseId: 'phase-1',
            schemaVersion: 1,
        } as const;
        const end = {
            boundary: 'end',
            epochMs: 102,
            metadata: { items: 50_000 },
            monotonicMs: 22,
            outcome: 'success',
            phase: 'store.m3u-import-dispatch',
            phaseId: 'phase-1',
            schemaVersion: 1,
        } as const;

        for (const invalid of [
            [start],
            [start, start, end],
            [start, { ...end, phase: 'store.m3u-publish-channels' }],
            [start, { ...end, metadata: { items: 10_000 } }],
            [{ ...start, outcome: 'success' }, end],
            [start, { ...end, outcome: undefined }],
            [start, { ...end, epochMs: 99 }],
            [start, { ...end, monotonicMs: 19 }],
            [start, { ...end, metadata: { items: -1 } }],
        ]) {
            assert.throws(
                () => pairRendererPerformancePhaseEvents(invalid),
                /renderer-performance-phase-events-invalid/
            );
        }
    });

    it('requires exactly one successful event for a named phase', () => {
        const successful = {
            durationMs: 2,
            endedEpochMs: 102,
            metadata: { items: 10_000 },
            outcome: 'success',
            phase: 'store.m3u-import-dispatch',
            phaseId: 'phase-1',
            startedEpochMs: 100,
        } as const;
        const failed = {
            ...successful,
            outcome: 'error',
            phaseId: 'phase-2',
        } as const;

        assert.throws(
            () =>
                requireRendererPerformancePhase(
                    [successful],
                    'store.m3u-publish-channels'
                ),
            /renderer-performance-phase-missing:store.m3u-publish-channels/
        );
        assert.throws(
            () =>
                requireRendererPerformancePhase(
                    [successful, successful],
                    'store.m3u-import-dispatch'
                ),
            /renderer-performance-phase-ambiguous:store.m3u-import-dispatch/
        );
        assert.throws(
            () =>
                requireRendererPerformancePhase(
                    [failed],
                    'store.m3u-import-dispatch'
                ),
            /renderer-performance-phase-failed:store.m3u-import-dispatch/
        );
    });
});
