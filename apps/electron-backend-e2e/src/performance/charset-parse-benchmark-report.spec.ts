import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    CHARSET_BENCHMARK_VARIANTS,
    type CharsetBenchmarkVariant,
    type CharsetCaseMeasurement,
    compareCharsets,
    formatCharsetReport,
    medianOf,
    summarizeSelfSamples,
    variantOrderForRound,
} from './charset-parse-benchmark-report';

function measurement(
    variant: CharsetBenchmarkVariant,
    cpuMs: number[],
    profileSamples: number,
    workload = 'm3u parse'
): CharsetCaseMeasurement {
    return {
        workload,
        variant,
        inputBytes: 10,
        inputLength: 10,
        hasNonLatin1Characters: variant !== 'latin1',
        wallClockMs: cpuMs.map((value) => value * 2),
        cpuMs,
        profileSamples,
        topSelfFrames: [],
    };
}

describe('charset parse benchmark report', () => {
    it('rotates the starting variant every round', () => {
        assert.deepEqual(variantOrderForRound(0), [
            'latin1',
            'latin1-bom',
            'cyrillic',
        ]);
        assert.deepEqual(variantOrderForRound(1), [
            'latin1-bom',
            'cyrillic',
            'latin1',
        ]);
        assert.deepEqual(variantOrderForRound(2), [
            'cyrillic',
            'latin1',
            'latin1-bom',
        ]);
        assert.deepEqual(variantOrderForRound(3), variantOrderForRound(0));
        for (let round = 0; round < 6; round += 1) {
            assert.deepEqual(
                [...variantOrderForRound(round)].sort(),
                [...CHARSET_BENCHMARK_VARIANTS].sort()
            );
        }
    });

    it('takes the median of odd and even samples without mutating them', () => {
        const values = [5, 1, 3];

        assert.equal(medianOf(values), 3);
        assert.deepEqual(values, [5, 1, 3]);
        assert.equal(medianOf([4, 1, 3, 2]), 2.5);
        assert.throws(() => medianOf([]), /empty sample/);
    });

    it('counts self samples per frame, most frequent first', () => {
        const summary = summarizeSelfSamples(
            {
                nodes: [
                    {
                        id: 1,
                        callFrame: {
                            functionName: '',
                            url: '',
                            lineNumber: -1,
                        },
                    },
                    {
                        id: 2,
                        callFrame: {
                            functionName: 'scanAttributes',
                            url: 'file:///repo/node_modules/iptv-playlist-parser/src/index.js',
                            lineNumber: 42,
                        },
                    },
                ],
                samples: [2, 2, 1, 2, 9],
            },
            2
        );

        assert.equal(summary.total, 5);
        assert.deepEqual(summary.top, [
            { frame: 'scanAttributes index.js:43', samples: 3 },
            { frame: '(anonymous)', samples: 1 },
        ]);
    });

    it('compares every variant with latin1 and flags only slowdowns seen by both signals', () => {
        const [comparison] = compareCharsets([
            measurement('latin1', [10, 12, 11], 100),
            measurement('latin1-bom', [16, 17, 18], 140),
            measurement('cyrillic', [16, 17, 18], 160),
        ]);

        assert.equal(comparison.workload, 'm3u parse');
        assert.deepEqual(
            comparison.variants.map((row) => row.variant),
            [...CHARSET_BENCHMARK_VARIANTS]
        );
        const [latin1, bom, cyrillic] = comparison.variants;
        assert.equal(latin1.cpuRatio, 1);
        assert.equal(latin1.exceedsThreshold, false);
        assert.equal(bom.cpuP50Ms, 17);
        assert.equal(bom.wallP50Ms, 34);
        assert.ok(Math.abs(bom.cpuRatio - 17 / 11) < 1e-9);
        // CPU time is over 1.5x, but profile samples (1.4x) are not.
        assert.equal(bom.exceedsThreshold, false);
        assert.equal(cyrillic.sampleRatio, 1.6);
        assert.equal(cyrillic.exceedsThreshold, true);
    });

    it('fails when a variant was not measured', () => {
        assert.throws(
            () =>
                compareCharsets([
                    measurement('latin1', [1], 1),
                    measurement('cyrillic', [1], 1),
                ]),
            /Missing latin1-bom measurement for m3u parse/
        );
    });

    it('formats one markdown row per workload and variant', () => {
        const report = formatCharsetReport(
            compareCharsets([
                measurement('latin1', [10], 100),
                measurement('latin1-bom', [11], 100),
                measurement('cyrillic', [20], 200),
            ])
        );
        const lines = report.split('\n');

        assert.equal(lines.length, 5);
        assert.match(lines[0], /^\| Workload \| Input \|/);
        assert.equal(
            lines[4],
            '| m3u parse | cyrillic | 40.0 | 20.0 | 200 | 2.00x | 2.00x | 2.00x | yes |'
        );
    });
});
