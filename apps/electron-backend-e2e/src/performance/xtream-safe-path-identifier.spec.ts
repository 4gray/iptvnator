import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { XTREAM_MEMORY_ACCOUNTING } from './xtream-summary-contract';
import { BUILD_IDENTITY } from './xtream-benchmark-report.fixtures';
import {
    assertXtreamBenchmarkManifest,
    assertXtreamSafePathIdentifier,
} from './xtream-exact-schema';

describe('Xtream safe path identifiers', () => {
    it('accepts portable benchmark path segments', () => {
        for (const identifier of [
            'run-01',
            'diagnostic',
            'xtream-refresh-large',
            'baseline.v1',
        ]) {
            assert.doesNotThrow(() =>
                assertXtreamSafePathIdentifier(identifier, 'run-id')
            );
        }
    });

    it('rejects traversal, trailing dots, and Windows device basenames', () => {
        for (const identifier of [
            '',
            '.',
            '..',
            '../../outside',
            'run/02',
            'run\\02',
            'drive:stream',
            'run.',
            'CON',
            'con.json',
            'PRN.log',
            'AUX',
            'nul.txt',
            'COM1',
            'com9.cpuprofile',
            'LPT1',
            'lpt9.trace.json',
        ]) {
            assert.throws(
                () => assertXtreamSafePathIdentifier(identifier, 'run-id'),
                /^Error: benchmark requires a safe Xtream run-id$/
            );
        }
    });

    it('applies the same boundary to manifest variants before path use', () => {
        assert.throws(
            () =>
                assertXtreamBenchmarkManifest({
                    build: BUILD_IDENTITY,
                    environment: {
                        cdpAddress: '127.0.0.1',
                        cdpPort: 9222,
                        databaseWorkerBatchDelayMs: 0,
                        exposeGc: true,
                        freshUserDataPerIteration: true,
                        perfCapture: '1',
                        perfWorkerProfiling: '1',
                        traceRendererConsole: '0',
                    },
                    fixture: {
                        bytes: 1,
                        catalogSha256: 'a'.repeat(64),
                        categories: 100,
                        items: 100_000,
                        scenario: 'performance-100k',
                        seed: 91_001,
                    },
                    memoryAccounting: XTREAM_MEMORY_ACCOUNTING,
                    mode: 'formal',
                    runtime: {
                        arch: 'arm64',
                        electronVersion: '38.0.0',
                        harnessNodeVersion: '22.0.0',
                        platform: 'darwin',
                    },
                    source: {
                        gitCommit: 'a'.repeat(40),
                        gitDiffSha256: 'b'.repeat(64),
                        gitDirty: false,
                    },
                    suite: 'xtream-performance-100k',
                    variant: 'CON.json',
                }),
            /^Error: invalid Xtream benchmark manifest$/
        );
    });
});
