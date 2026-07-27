import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    pairPerformancePhaseEvents,
    requirePerformancePhase,
} from './performance-phase-events';

describe('performance phase event pairing', () => {
    it('pairs request-scoped boundaries and preserves end metadata', () => {
        const phases = pairPerformancePhaseEvents([
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 100,
                phase: 'data.acquire',
                requestId: 'request-1',
            },
            {
                boundary: 'end',
                durationMs: 12.5,
                epochMs: 113,
                metadata: { byteCount: 2048, itemCount: 10 },
                phase: 'data.acquire',
                requestId: 'request-1',
            },
        ]);

        assert.deepEqual(phases, [
            {
                durationMs: 12.5,
                endedEpochMs: 113,
                metadata: { byteCount: 2048, itemCount: 10 },
                phase: 'data.acquire',
                requestId: 'request-1',
                startedEpochMs: 100,
            },
        ]);
        assert.deepEqual(
            requirePerformancePhase(phases, 'request-1', 'data.acquire'),
            phases[0]
        );
    });

    it('pairs interleaved requests without cross-correlating them', () => {
        const phases = pairPerformancePhaseEvents([
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 100,
                phase: 'serialize.playlist',
                requestId: 'request-a',
            },
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 101,
                phase: 'serialize.playlist',
                requestId: 'request-b',
            },
            {
                boundary: 'end',
                durationMs: 3,
                epochMs: 104,
                phase: 'serialize.playlist',
                requestId: 'request-b',
            },
            {
                boundary: 'end',
                durationMs: 8,
                epochMs: 108,
                phase: 'serialize.playlist',
                requestId: 'request-a',
            },
        ]);

        assert.deepEqual(
            phases.map(({ durationMs, requestId }) => ({
                durationMs,
                requestId,
            })),
            [
                { durationMs: 8, requestId: 'request-a' },
                { durationMs: 3, requestId: 'request-b' },
            ]
        );
    });

    it('fails closed for orphaned, duplicate, malformed, or reversed boundaries', () => {
        const validStart = {
            boundary: 'start',
            durationMs: null,
            epochMs: 100,
            phase: 'normalize',
            requestId: 'request-1',
        } as const;
        const validEnd = {
            boundary: 'end',
            durationMs: 2,
            epochMs: 102,
            phase: 'normalize',
            requestId: 'request-1',
        } as const;

        for (const invalid of [
            [validStart],
            [validStart, validStart, validEnd],
            [validStart, { ...validEnd, durationMs: null }],
            [validStart, { ...validEnd, epochMs: 99 }],
            [{ ...validStart, durationMs: 0 }, validEnd],
            [
                validStart,
                {
                    ...validEnd,
                    metadata: { byteCount: -1 },
                },
            ],
        ]) {
            assert.throws(
                () => pairPerformancePhaseEvents(invalid),
                /performance-phase-events-invalid/
            );
        }
    });

    it('requires one exact request and phase match', () => {
        const phases = pairPerformancePhaseEvents([
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 100,
                phase: 'normalize',
                requestId: 'request-1',
            },
            {
                boundary: 'end',
                durationMs: 2,
                epochMs: 102,
                phase: 'normalize',
                requestId: 'request-1',
            },
        ]);

        assert.throws(
            () => requirePerformancePhase(phases, 'request-2', 'normalize'),
            /performance-phase-missing:request-2:normalize/
        );
        assert.throws(
            () =>
                requirePerformancePhase(
                    [...phases, ...phases],
                    'request-1',
                    'normalize'
                ),
            /performance-phase-ambiguous:request-1:normalize/
        );
    });
});
