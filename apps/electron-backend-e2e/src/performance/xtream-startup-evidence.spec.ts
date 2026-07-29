import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { XTREAM_SCENARIO_ID } from './xtream-benchmark-contract';
import { createXtreamAssemblerFixture } from './xtream-iteration-assembler.fixture';
import { assembleXtreamRawIteration } from './xtream-iteration-assembler';

describe('Xtream startup evidence', () => {
    it('rejects an attempt count that does not match its retry reasons', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );

        assert.throws(
            () =>
                assembleXtreamRawIteration({
                    ...input,
                    process: {
                        ...input.process,
                        startupAttemptCount: 2,
                        startupRetryReasons: [],
                    },
                }),
            /xtream-iteration-assembly-invalid/
        );
    });

    it('binds retry evidence into the capture generation identity', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const firstAttempt = assembleXtreamRawIteration(input);
        const secondAttempt = assembleXtreamRawIteration({
            ...input,
            process: {
                ...input.process,
                startupAttemptCount: 2,
                startupRetryReasons: ['sqlite-database-locked'],
            },
        });

        assert.notEqual(
            firstAttempt.processIdentity.generationIdentitySha256,
            secondAttempt.processIdentity.generationIdentitySha256
        );
    });
});
