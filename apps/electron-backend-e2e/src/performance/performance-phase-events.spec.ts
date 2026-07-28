import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createDiagnosticsPerformancePhaseEventParser,
    pairPerformancePhaseEvents,
    requirePerformancePhase,
} from './performance-phase-events';

describe('performance phase event pairing', () => {
    it('restores and invokes the diagnostics parser without module-scoped helpers', () => {
        const restore = <T>(source: string): T =>
            new Function(`"use strict"; return (${source});`)() as T;
        const restored = restore<
            typeof createDiagnosticsPerformancePhaseEventParser
        >(createDiagnosticsPerformancePhaseEventParser.toString());
        const parse = restored({
            allowedPhases: ['xtream.network.total'],
            timelineType: 'xtream-main-phase',
        });

        assert.deepEqual(
            parse({
                boundary: 'start',
                durationMs: null,
                epochMs: 100,
                phase: 'xtream.network.total',
                requestId: 'xtream-mock1-1',
            }),
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 100,
                phase: 'xtream.network.total',
                requestId: 'xtream-mock1-1',
                type: 'xtream-main-phase',
            }
        );
    });

    it('keeps the valid M3U diagnostics normalization byte-identical when subscriptions are parameterized', () => {
        const parse = createDiagnosticsPerformancePhaseEventParser({
            allowedPhases: ['data.acquire', 'parse.m3u', 'normalize'],
            timelineType: 'm3u-import-phase',
        });
        const incoming = {
            boundary: 'end',
            durationMs: 12.5,
            epochMs: 113,
            metadata: { byteCount: 2048, itemCount: 10 },
            phase: 'data.acquire',
            requestId: 'request-1',
        };
        const legacyNormalized = {
            boundary: 'end',
            byteCount: 2048,
            durationMs: 12.5,
            epochMs: 113,
            itemCount: 10,
            phase: 'data.acquire',
            requestId: 'request-1',
            type: 'm3u-import-phase',
        };

        assert.equal(
            JSON.stringify(parse(incoming)),
            JSON.stringify(legacyNormalized)
        );
        assert.equal(parse({ ...incoming, secret: 'not allowed' }), null);
        assert.equal(parse({ ...incoming, metadata: { itemCount: -1 } }), null);
    });

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
