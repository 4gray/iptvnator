import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { maxLinesBaseline } from './max-lines-baseline.mjs';
import {
    BASELINE_PATH,
    computeOffenders,
    renderBaseline,
} from './generate-max-lines-baseline.mjs';
import {
    MAX_LINES_OPTIONS,
    MAX_LINES_PROD,
    MAX_LINES_TEST,
    TEST_FILE_GLOBS,
} from './max-lines-config.mjs';

describe('max-lines baseline', () => {
    it('matches what the generator produces', () => {
        // The whole point of the baseline is that it lists files which really do
        // exceed the limit. A stale entry silently exempts a file that was
        // already split, and a missing entry turns CI red on an unrelated PR.
        assert.equal(
            readFileSync(BASELINE_PATH, 'utf8'),
            renderBaseline(computeOffenders()),
            'Baseline is out of date — run: node tools/eslint/generate-max-lines-baseline.mjs'
        );
    });

    it('never lists a file twice', () => {
        assert.equal(
            new Set(maxLinesBaseline).size,
            maxLinesBaseline.length,
            'baseline contains duplicate entries'
        );
    });

    it('stays sorted so regenerating produces a reviewable diff', () => {
        assert.deepEqual(
            maxLinesBaseline,
            [...maxLinesBaseline].sort((a, b) => a.localeCompare(b))
        );
    });
});

describe('max-lines config', () => {
    it('gives tests more headroom than production code', () => {
        // A spec is a flat list of independent cases; holding it to the
        // production ceiling produces arbitrary `-2.spec.ts` splits.
        assert.ok(
            MAX_LINES_TEST > MAX_LINES_PROD,
            `expected test ceiling (${MAX_LINES_TEST}) above production (${MAX_LINES_PROD})`
        );
    });

    it('does not count comments or blank lines', () => {
        // This repo mandates documentation, so a docblock must never be the
        // reason a file has to be split.
        assert.equal(MAX_LINES_OPTIONS.skipComments, true);
        assert.equal(MAX_LINES_OPTIONS.skipBlankLines, true);
    });

    it('routes specs, e2e specs and e2e apps to the test ceiling', () => {
        for (const glob of [
            '**/*.spec.ts',
            '**/*.e2e.ts',
            'apps/*-e2e/**/*.ts',
        ]) {
            assert.ok(
                TEST_FILE_GLOBS.includes(glob),
                `expected ${glob} among the test globs`
            );
        }
    });
});
