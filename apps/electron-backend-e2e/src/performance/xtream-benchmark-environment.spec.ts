import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { XtreamBenchmarkManifest } from './xtream-benchmark-contract';
import { createXtreamBenchmarkSummary } from './xtream-benchmark-report';
import {
    MANIFEST,
    clearXtreamReportFixtureDirectories,
} from './xtream-benchmark-report.fixtures';
import {
    clearXtreamProvenanceFixtureDirectories,
    smokeReportFixture,
} from './xtream-benchmark-report-provenance.fixtures';
import { assertXtreamBenchmarkManifest } from './xtream-exact-schema';

afterEach(async () => {
    await Promise.all([
        clearXtreamReportFixtureDirectories(),
        clearXtreamProvenanceFixtureDirectories(),
    ]);
});

describe('Xtream benchmark CDP environment', () => {
    it('allows a bounded alternate smoke port but keeps formal capture on 9222', async () => {
        const smokeManifest: XtreamBenchmarkManifest = {
            ...MANIFEST,
            environment: { ...MANIFEST.environment, cdpPort: 9322 },
            mode: 'smoke',
        };
        assert.doesNotThrow(() => assertXtreamBenchmarkManifest(smokeManifest));
        assert.throws(
            () =>
                assertXtreamBenchmarkManifest({
                    ...smokeManifest,
                    mode: 'formal',
                }),
            /invalid Xtream benchmark manifest/
        );

        const { diagnosticEvidence, iterations } = await smokeReportFixture();
        const summary = createXtreamBenchmarkSummary(
            smokeManifest,
            iterations,
            diagnosticEvidence
        );
        assert.equal(summary.validForComparison, false);
    });

    it('requires an integer CDP port from 1024 through 65535', () => {
        for (const cdpPort of [1023, 65536, 9322.5, Number.NaN]) {
            assert.throws(
                () =>
                    assertXtreamBenchmarkManifest({
                        ...MANIFEST,
                        environment: { ...MANIFEST.environment, cdpPort },
                        mode: 'smoke',
                    }),
                /invalid Xtream benchmark manifest/
            );
        }
    });
});
