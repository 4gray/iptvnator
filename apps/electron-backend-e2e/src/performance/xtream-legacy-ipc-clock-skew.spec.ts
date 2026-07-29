import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { XTREAM_SCENARIO_ID } from './xtream-benchmark-contract';
import { assembleXtreamRawIteration } from './xtream-iteration-assembler';
import { createXtreamAssemblerFixture } from './xtream-iteration-assembler.fixture';

describe('Xtream legacy IPC clock skew', () => {
    it('normalizes sub-millisecond response skew and rejects larger reversals', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.REFRESH_LARGE
        );
        const request = input.mainCapture.requests.find(
            ({ operation }) => operation === 'DB_UPSERT_APP_PLAYLIST'
        );
        assert.equal(typeof request?.responseEpochMs, 'number');
        const updateSuccessEpoch = (sourceEpochMs: number) => ({
            ...input,
            mainCapture: {
                ...input.mainCapture,
                capture: {
                    ...input.mainCapture.capture,
                    timeline: input.mainCapture.capture.timeline.map((record) =>
                        record.type === 'preload-performance-success' &&
                        record.ipcCallId === request?.ipcCallId &&
                        record.operation === request.operation
                            ? { ...record, sourceEpochMs }
                            : record
                    ),
                },
            },
        });

        const normalized = assembleXtreamRawIteration(
            updateSuccessEpoch(Number(request?.responseEpochMs) - 0.25)
        );
        const response = normalized.phaseCapture.ipcSpans.find(
            ({ boundary, method }) =>
                boundary === 'response' &&
                method === 'dbUpsertAppPlaylist'
        );
        assert.ok(response);
        assert.equal(response.endEpochMs, response.startEpochMs);

        assert.throws(
            () =>
                assembleXtreamRawIteration(
                    updateSuccessEpoch(Number(request?.responseEpochMs) - 1)
                ),
            /xtream-iteration-assembly-invalid/
        );
    });
});
