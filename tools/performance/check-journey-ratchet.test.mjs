import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import {
    DEFAULT_BASELINES_PATH,
    compareToBaselines,
    formatResult,
    parseArgs,
    validateBaselines,
} from './check-journey-ratchet.mjs';

const scriptPath = fileURLToPath(
    new URL('./check-journey-ratchet.mjs', import.meta.url)
);
const committedBaselinesPath = fileURLToPath(
    new URL('./journey-baselines.json', import.meta.url)
);

const baselines = {
    version: 1,
    journeys: {
        launch: {
            'renderer.initialBytes': { value: 2750491, unit: 'bytes' },
            spawnToFirstCardMs: {
                value: 1000,
                unit: 'ms',
                toleranceRatio: 1.25,
            },
        },
    },
};

const summaryWith = (initialBytes, wallClockMs = 1000) => ({
    journeys: {
        launch: {
            counters: { 'renderer.initialBytes': initialBytes },
            wallClock: { spawnToFirstCardMs: wallClockMs },
        },
    },
});

let workDir;

before(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'check-journey-ratchet-'));
});

after(async () => {
    await rm(workDir, { recursive: true, force: true });
});

test('a counter equal to its baseline passes', () => {
    const result = compareToBaselines({
        baselines,
        summary: summaryWith(2750491),
    });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.tightenable, []);
    assert.equal(result.passed.length, 2);
    assert.match(
        result.passed[0],
        /launch\/renderer\.initialBytes: 2,750,491 bytes within baseline 2,750,491/
    );
});

test('a counter one byte above its baseline fails with the delta', () => {
    const result = compareToBaselines({
        baselines,
        summary: summaryWith(2750492),
    });
    assert.equal(result.failures.length, 1);
    assert.match(
        result.failures[0],
        /launch\/renderer\.initialBytes: 2,750,492 bytes exceeds baseline 2,750,491 by 1 bytes/
    );
    assert.match(result.failures[0], /baselines only move down/);
});

test('a counter below its baseline passes and asks to tighten', () => {
    const result = compareToBaselines({
        baselines,
        summary: summaryWith(2600000),
    });
    assert.deepEqual(result.failures, []);
    assert.equal(result.tightenable.length, 1);
    assert.match(
        result.tightenable[0],
        /below baseline 2,750,491 by 150,491 bytes/
    );
    assert.match(
        result.tightenable[0],
        new RegExp(DEFAULT_BASELINES_PATH.replace(/\//g, '\\/'))
    );
});

test('wall-clock entries fail only above value × toleranceRatio', () => {
    const within = compareToBaselines({
        baselines,
        summary: summaryWith(2750491, 1250),
    });
    assert.deepEqual(within.failures, []);
    assert.match(
        within.passed[1],
        /1,250 ms within 1,250 \(baseline 1,000 × 1\.25\)/
    );

    const above = compareToBaselines({
        baselines,
        summary: summaryWith(2750491, 1251),
    });
    assert.equal(above.failures.length, 1);
    assert.match(
        above.failures[0],
        /spawnToFirstCardMs: 1,251 ms exceeds 1,250 \(baseline 1,000 × 1\.25\) by 1 ms/
    );

    const below = compareToBaselines({
        baselines,
        summary: summaryWith(2750491, 900),
    });
    assert.equal(below.tightenable.length, 1);
    assert.match(
        below.tightenable[0],
        /spawnToFirstCardMs: 900 ms is below baseline 1,000/
    );
});

test('a baseline without a measurement fails instead of being skipped', () => {
    const result = compareToBaselines({
        baselines,
        summary: { journeys: { launch: { counters: {} } } },
    });
    assert.equal(result.failures.length, 2);
    assert.match(
        result.failures[0],
        /renderer\.initialBytes: baseline 2,750,491 bytes has no measurement/
    );
    assert.match(
        result.failures[0],
        /cannot be bypassed by dropping a measurement/
    );
});

test('an empty or malformed summary fails every baseline', () => {
    assert.equal(
        compareToBaselines({ baselines, summary: {} }).failures.length,
        2
    );
    assert.equal(
        compareToBaselines({ baselines, summary: null }).failures.length,
        2
    );
    const nonNumeric = compareToBaselines({
        baselines,
        summary: {
            journeys: {
                launch: { counters: { 'renderer.initialBytes': '2750491' } },
            },
        },
    });
    assert.match(nonNumeric.failures[0], /"2750491" is not a finite number/);
});

test('a measured counter without a baseline is reported but does not fail', () => {
    const summary = summaryWith(2750491);
    summary.journeys.launch.counters['renderer.cdTicksToFirstCard'] = 12;
    summary.journeys.search = { counters: { sqlStatementsPerKeystroke: 3 } };
    const result = compareToBaselines({ baselines, summary });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(
        result.unbaselined.map((line) => line.split(':')[0]),
        [
            'launch/renderer.cdTicksToFirstCard',
            'search/sqlStatementsPerKeystroke',
        ]
    );
});

test('rejects malformed baseline files', () => {
    assert.throws(() => validateBaselines({}), /object with a "journeys" map/);
    assert.throws(
        () => validateBaselines({ journeys: { launch: [] } }),
        /journey "launch" must map/
    );
    assert.throws(
        () =>
            validateBaselines({
                journeys: { launch: { x: { value: 'big' } } },
            }),
        /Baseline launch\/x needs a finite numeric "value"/
    );
    assert.throws(
        () =>
            validateBaselines({
                journeys: { launch: { x: { value: 1, toleranceRatio: 0.5 } } },
            }),
        /invalid "toleranceRatio"/
    );
});

test('formats a summary line for both outcomes', () => {
    const ok = formatResult(
        compareToBaselines({ baselines, summary: summaryWith(2600000) })
    );
    assert.match(ok, /^ok {7}launch\/spawnToFirstCardMs/m);
    assert.match(ok, /^tighten {2}launch\/renderer\.initialBytes/m);
    assert.match(
        ok,
        /Journey ratchet OK: 2 baselines checked, 1 can be tightened\.$/
    );

    const failed = formatResult(
        compareToBaselines({ baselines, summary: summaryWith(3000000) })
    );
    assert.match(failed, /^FAIL {5}launch\/renderer\.initialBytes/m);
    assert.match(
        failed,
        /Journey ratchet failed: 1 of 2 baselines exceeded\.$/
    );
});

test('parses CLI arguments and requires --summary', () => {
    assert.deepEqual(parseArgs(['--summary', 's.json']), {
        summary: 's.json',
        baselines: DEFAULT_BASELINES_PATH,
    });
    assert.deepEqual(
        parseArgs(['--', '--summary=s.json', '--baselines=b.json']),
        {
            summary: 's.json',
            baselines: 'b.json',
        }
    );
    assert.throws(
        () => parseArgs([]),
        /--summary <journey-summary\.json> is required/
    );
    assert.throws(
        () => parseArgs(['--summary']),
        /Missing value for --summary/
    );
    assert.throws(
        () => parseArgs(['--summary', 's', '--strict']),
        /Unknown argument: --strict/
    );
});

test('the committed baselines file is valid and every entry names its evidence fields', async () => {
    const committed = JSON.parse(
        await readFile(committedBaselinesPath, 'utf8')
    );
    validateBaselines(committed);
    for (const entries of Object.values(committed.journeys)) {
        for (const entry of Object.values(entries)) {
            assert.match(entry.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
            assert.ok(
                'evidencePr' in entry,
                'evidencePr must be present (null before the first PR)'
            );
            assert.equal(typeof entry.measuredWith, 'string');
        }
    }
});

async function runCli(summary, extraBaselines = baselines) {
    const summaryPath = path.join(
        workDir,
        `summary-${Date.now()}-${Math.random()}.json`
    );
    const baselinesPath = path.join(
        workDir,
        `baselines-${Date.now()}-${Math.random()}.json`
    );
    await writeFile(summaryPath, JSON.stringify(summary));
    await writeFile(baselinesPath, JSON.stringify(extraBaselines));
    return spawnSync(
        process.execPath,
        [scriptPath, '--summary', summaryPath, '--baselines', baselinesPath],
        { encoding: 'utf8' }
    );
}

test('CLI exits 0 when within baselines and 1 when a counter grew', async () => {
    const ok = await runCli(summaryWith(2750491));
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Journey ratchet OK/);

    const grew = await runCli(summaryWith(2750492));
    assert.equal(grew.status, 1);
    assert.match(grew.stderr, /FAIL {5}launch\/renderer\.initialBytes/);
});

test('CLI exits 1 with a readable message when the summary is missing', () => {
    const result = spawnSync(
        process.execPath,
        [scriptPath, '--summary', path.join(workDir, 'nope.json')],
        { encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /check-journey-ratchet: Cannot read journey summary at/
    );
});
