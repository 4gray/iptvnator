import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    formatJourneyOutputTimestamp,
    JOURNEY_SUMMARY_SCHEMA_VERSION,
    percentile,
    resolveJourneySummaryPath,
    summarizeJourneyIterations,
    writeJourneySummary,
    type JourneyIterationRecord,
    type JourneySummary,
} from './journey-summary';

function iteration(
    index: number,
    counters: Record<string, number>,
    wallClock: Record<string, number>,
    warmup = false
): JourneyIterationRecord {
    return {
        counters,
        evidence: {},
        index,
        pid: 100 + index,
        wallClock,
        warmup,
    };
}

test('percentile interpolates linearly like the shared statistics helper', () => {
    assert.equal(percentile([10], 90), 10);
    assert.equal(percentile([30, 10, 20], 50), 20);
    assert.equal(percentile([10, 20, 30, 40, 50], 90), 46);
    assert.equal(percentile([10, 20, 30, 40, 50], 0), 10);
    assert.throws(() => percentile([], 50), /percentile-input/);
    assert.throws(() => percentile([1], 101), /percentile-input/);
});

test('summarizes exact counters and P50/P90 wall-clock from measured iterations only', () => {
    const entry = summarizeJourneyIterations(
        [
            iteration(
                0,
                { 'renderer.x': 99 },
                { spawnToFirstCardMs: 9_000 },
                true
            ),
            iteration(1, { 'renderer.x': 12 }, { spawnToFirstCardMs: 1_000 }),
            iteration(2, { 'renderer.x': 12 }, { spawnToFirstCardMs: 1_200 }),
            iteration(3, { 'renderer.x': 12 }, { spawnToFirstCardMs: 1_100 }),
            iteration(4, { 'renderer.x': 12 }, { spawnToFirstCardMs: 1_300 }),
            iteration(5, { 'renderer.x': 12 }, { spawnToFirstCardMs: 1_400 }),
        ],
        { 'renderer.y': 'not measurable' }
    );
    assert.deepEqual(entry.counters, { 'renderer.x': 12 });
    assert.deepEqual(entry.counterStability, {
        'renderer.x': { stable: true, values: [12, 12, 12, 12, 12] },
    });
    assert.deepEqual(entry.wallClock, {
        'spawnToFirstCardMs.p50': 1_200,
        'spawnToFirstCardMs.p90': 1_360,
    });
    assert.deepEqual(entry.unavailable, { 'renderer.y': 'not measurable' });
    assert.equal(entry.iterations.length, 6);
});

test('reports the maximum and flags instability when measured counters disagree', () => {
    const entry = summarizeJourneyIterations(
        [
            iteration(0, { a: 3, b: 0.5 }, { w: 1 }),
            iteration(1, { a: 5, b: 0.5 }, { w: 2 }),
            iteration(2, { a: 4, b: 0.5 }, { w: 3 }),
        ],
        {}
    );
    assert.deepEqual(entry.counters, { a: 5, b: 0.5 });
    assert.deepEqual(entry.counterStability['a'], {
        stable: false,
        values: [3, 5, 4],
    });
    assert.deepEqual(entry.counterStability['b'], {
        stable: true,
        values: [0.5, 0.5, 0.5],
    });
    assert.deepEqual(entry.wallClock, { 'w.p50': 2, 'w.p90': 2.8 });
});

test('rejects runs that cannot produce an exact summary', () => {
    assert.throws(
        () =>
            summarizeJourneyIterations(
                [iteration(0, { a: 1 }, { w: 1 }, true)],
                {}
            ),
        /no-measured-iterations/
    );
    assert.throws(
        () =>
            summarizeJourneyIterations(
                [
                    iteration(0, { a: 1 }, { w: 1 }),
                    iteration(1, { b: 1 }, { w: 1 }),
                ],
                {}
            ),
        /counter-set-mismatch-iteration-1/
    );
    assert.throws(
        () =>
            summarizeJourneyIterations(
                [
                    iteration(0, { a: 1 }, { w: 1 }),
                    iteration(1, { a: 1 }, { v: 1 }),
                ],
                {}
            ),
        /wall-clock-set-mismatch-iteration-1/
    );
    assert.throws(
        () =>
            summarizeJourneyIterations(
                [iteration(0, { a: Number.NaN }, { w: 1 })],
                {}
            ),
        /counter-not-finite-a/
    );
    const duplicate = { ...iteration(1, { a: 1 }, { w: 1 }), pid: 100 };
    assert.throws(
        () =>
            summarizeJourneyIterations(
                [iteration(0, { a: 1 }, { w: 1 }), duplicate],
                {}
            ),
        /duplicate-pid/
    );
});

test('writes the summary below dist/performance/journeys/<timestamp> and never overwrites', async () => {
    const date = new Date('2026-09-26T10:49:12.345Z');
    assert.equal(formatJourneyOutputTimestamp(date), '20260926T104912Z');
    assert.throws(
        () => formatJourneyOutputTimestamp(new Date('nope')),
        /invalid-date/
    );
    const root = await mkdtemp(join(tmpdir(), 'iptvnator-journey-summary-'));
    try {
        const summaryPath = resolveJourneySummaryPath(root, date);
        assert.equal(
            summaryPath,
            join(
                root,
                'dist',
                'performance',
                'journeys',
                '20260926T104912Z',
                'summary.json'
            )
        );
        const summary: JourneySummary = {
            generatedAt: date.toISOString(),
            harness: {
                arch: 'arm64',
                ci: false,
                electron: '43.0.0',
                electronMain: 'dist/apps/electron-backend/main.js',
                measuredIterations: 1,
                node: 'v22',
                platform: 'darwin',
                rendererIndex: 'dist/apps/web/index.html',
                warmupIterations: 0,
            },
            journeys: {
                launch: summarizeJourneyIterations(
                    [iteration(0, { a: 1 }, { w: 1 })],
                    {}
                ),
            },
            schemaVersion: JOURNEY_SUMMARY_SCHEMA_VERSION,
        };
        await writeJourneySummary(summaryPath, summary);
        const written = JSON.parse(
            await readFile(summaryPath, 'utf8')
        ) as JourneySummary;
        assert.equal(written.journeys['launch']?.counters['a'], 1);
        assert.equal(written.journeys['launch']?.wallClock['w.p50'], 1);
        await assert.rejects(
            writeJourneySummary(summaryPath, summary),
            /EEXIST/
        );
    } finally {
        await rm(root, { force: true, recursive: true });
    }
});
