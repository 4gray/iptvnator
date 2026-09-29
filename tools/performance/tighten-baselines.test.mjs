import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { compareBaselineDirection } from './check-baseline-direction.mjs';
import {
    fillEvidencePr,
    formatReport,
    mergeRunSummaries,
    parseArgs,
    tightenBaselines,
} from './tighten-baselines.mjs';

const scriptPath = fileURLToPath(
    new URL('./tighten-baselines.mjs', import.meta.url)
);
const RUN_URL = 'https://github.com/4gray/iptvnator/actions/runs/1';

const baselinesFile = (entries) => ({
    version: 1,
    journeys: {
        launch: {
            'renderer.initialBytes': {
                value: 1000,
                unit: 'bytes',
                slack: 64,
                updatedAt: '2026-09-27',
                evidencePr: 1734,
                measuredWith:
                    'pnpm nx build web && pnpm run perf:initial-bytes',
            },
            ...entries,
        },
    },
});

const run = (launch) => ({ journeys: { launch } });
const bytesRun = (initialBytes) =>
    run({ counters: { 'renderer.initialBytes': initialBytes } });

const tighten = (baselines, runs) =>
    tightenBaselines({
        baselines,
        runs,
        evidenceRun: RUN_URL,
        date: '2026-10-05',
    });

let workDir;
before(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'tighten-baselines-'));
});
after(async () => {
    await rm(workDir, { recursive: true, force: true });
});

test('a counter below its value in every run drops to the largest run', () => {
    const baselines = baselinesFile();
    const result = tighten(baselines, [
        bytesRun(990),
        bytesRun(995),
        bytesRun(980),
    ]);
    assert.deepEqual(
        result.baselines.journeys.launch['renderer.initialBytes'],
        {
            value: 995,
            unit: 'bytes',
            slack: 64,
            updatedAt: '2026-10-05',
            evidencePr: 1734,
            measuredWith:
                '.github/workflows/performance-ratchet.yml, max of 3 runs',
            evidenceRun: RUN_URL,
        }
    );
    assert.equal(result.tightened.length, 1);
    assert.equal(
        baselines.journeys.launch['renderer.initialBytes'].value,
        1000,
        'the input is not mutated'
    );
    const direction = compareBaselineDirection({
        base: baselines,
        head: result.baselines,
    });
    assert.deepEqual(direction.failures, []);
    assert.deepEqual(direction.allowed, []);
    assert.match(direction.lowered[0], /1,064 -> 1,059 bytes/);
});

test('one run at or above the value keeps the baseline untouched', () => {
    for (const measured of [1000, 1010]) {
        const baselines = baselinesFile();
        const result = tighten(baselines, [
            bytesRun(990),
            bytesRun(measured),
            bytesRun(980),
        ]);
        assert.deepEqual(result.baselines, baselines);
        assert.deepEqual(result.tightened, []);
        assert.match(result.rows[0].reason, /not below 1,000 in every run/);
    }
});

test('an entry missing or non-numeric in any run is kept', () => {
    const missing = tighten(baselinesFile(), [
        bytesRun(990),
        run({ counters: {} }),
        bytesRun(980),
    ]);
    assert.deepEqual(missing.tightened, []);
    assert.match(missing.rows[0].reason, /not measured in run 2/);

    const invalid = tighten(baselinesFile(), [
        bytesRun(990),
        bytesRun(980),
        bytesRun('980'),
    ]);
    assert.deepEqual(invalid.tightened, []);
    assert.match(invalid.rows[0].reason, /run 3 measured "980"/);
});

test('a counter marked unstable in any run is skipped with the iterations', () => {
    const baselines = baselinesFile({
        'renderer.ipcCallsToFirstCard': { value: 20 },
    });
    const ipcRun = (value, stable = true) =>
        run({
            counters: {
                'renderer.initialBytes': 990,
                'renderer.ipcCallsToFirstCard': value,
            },
            counterStability: {
                'renderer.ipcCallsToFirstCard': {
                    stable,
                    values: stable ? [value, value] : [13, value],
                },
            },
        });
    const result = tighten(baselines, [
        ipcRun(16),
        ipcRun(16, false),
        ipcRun(16),
    ]);
    const row = result.rows.find(
        (entry) => entry.label === 'launch/renderer.ipcCallsToFirstCard'
    );
    assert.match(row.reason, /unstable in run 2 \(iterations 13, 16\)/);
    assert.equal(
        result.baselines.journeys.launch['renderer.ipcCallsToFirstCard'].value,
        20
    );
    assert.equal(
        result.baselines.journeys.launch['renderer.initialBytes'].value,
        990,
        'other entries are still tightened'
    );
});

test('a wall-clock entry drops to the largest P50 and keeps its tolerance', () => {
    const baselines = baselinesFile({
        'spawnToFirstCardMs.p50': {
            value: 1600,
            unit: 'ms',
            toleranceRatio: 1.25,
        },
    });
    const wallRun = (p50) =>
        run({
            counters: { 'renderer.initialBytes': 1000 },
            wallClock: {
                'spawnToFirstCardMs.p50': p50,
                'spawnToFirstCardMs.p90': 5000,
            },
            // counterStability does not apply to wall-clock entries.
            counterStability: {
                'spawnToFirstCardMs.p50': { stable: false },
            },
        });
    const result = tighten(baselines, [
        wallRun(1401.5),
        wallRun(1550.25),
        wallRun(1480),
    ]);
    assert.deepEqual(
        result.baselines.journeys.launch['spawnToFirstCardMs.p50'],
        {
            value: 1550.25,
            unit: 'ms',
            toleranceRatio: 1.25,
            updatedAt: '2026-10-05',
            measuredWith:
                '.github/workflows/performance-ratchet.yml, max of 3 runs',
            evidenceRun: RUN_URL,
        }
    );
    assert.deepEqual(
        compareBaselineDirection({ base: baselines, head: result.baselines })
            .failures,
        []
    );
});

test('fewer than three runs or no run URL is refused', () => {
    assert.throws(
        () => tighten(baselinesFile(), [bytesRun(990), bytesRun(990)]),
        /at least 3 runs; received 2/
    );
    assert.throws(
        () =>
            tightenBaselines({
                baselines: baselinesFile(),
                runs: [bytesRun(1), bytesRun(1), bytesRun(1)],
            }),
        /--evidence-run/
    );
});

test('entries are never added and values are never raised', () => {
    const baselines = baselinesFile();
    const result = tighten(baselines, [
        run({ counters: { 'renderer.initialBytes': 1200, newCounter: 1 } }),
        bytesRun(1200),
        bytesRun(1200),
    ]);
    assert.deepEqual(result.baselines, baselines);
});

test('summaries of one run merge; a duplicate measurement is an error', () => {
    const merged = mergeRunSummaries([
        bytesRun(990),
        run({
            counters: { 'renderer.ipcCallsToFirstCard': 16 },
            wallClock: { 'spawnToFirstCardMs.p50': 1400 },
        }),
    ]);
    assert.deepEqual(merged.journeys.launch.counters, {
        'renderer.initialBytes': 990,
        'renderer.ipcCallsToFirstCard': 16,
    });
    assert.throws(
        () => mergeRunSummaries([bytesRun(990), bytesRun(991)], 'run 2'),
        /run 2: journeys\.launch\.counters\.renderer\.initialBytes appears in two summaries/
    );
});

test('fillEvidencePr sets the PR only on entries from that run', () => {
    const baselines = baselinesFile({
        other: { value: 5, evidenceRun: 'https://example.invalid/runs/0' },
    });
    baselines.journeys.launch['renderer.initialBytes'].evidenceRun = RUN_URL;
    const { baselines: next, filled } = fillEvidencePr({
        baselines,
        evidenceRun: RUN_URL,
        pr: 1800,
    });
    assert.equal(filled, 1);
    assert.equal(
        next.journeys.launch['renderer.initialBytes'].evidencePr,
        1800
    );
    assert.equal(next.journeys.launch.other.evidencePr, undefined);
    assert.throws(
        () => fillEvidencePr({ baselines, evidenceRun: 'x', pr: 1 }),
        /No baseline carries evidenceRun x/
    );
});

test('the report lists every run value and the decision', () => {
    const result = tighten(baselinesFile({ gone: { value: 3 } }), [
        bytesRun(990),
        bytesRun(995),
        bytesRun(980),
    ]);
    const report = formatReport(result, ['a', 'b', 'c']);
    assert.match(
        report,
        /\| `launch\/renderer.initialBytes` \| 1,000 bytes \| 990 \| 995 \| 980 \| lowered to 995 bytes \|/
    );
    assert.match(
        report,
        /\| `launch\/gone` \| 3 \| — \| — \| — \| kept: not measured in run 1/
    );
    assert.match(report, /- Run 2: b/);
    assert.match(report, /Tightened 1 of 2 baselines\./);
});

test('parseArgs reads repeated runs and requires the run URL', () => {
    assert.deepEqual(
        parseArgs([
            '--run',
            'a.json',
            '--run=b',
            '--evidence-run',
            RUN_URL,
            '--date=2026-10-05',
        ]).runs,
        ['a.json', 'b']
    );
    assert.throws(() => parseArgs(['--run', 'a.json']), /--evidence-run/);
    assert.throws(
        () => parseArgs(['--evidence-run', RUN_URL, '--date', '5.10.2026']),
        /YYYY-MM-DD/
    );
    assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
    assert.throws(() => parseArgs(['--run']), /Missing value for --run/);
});

test('CLI rewrites the file only when a baseline was tightened', async () => {
    const baselinesPath = path.join(workDir, 'baselines.json');
    const original = `${JSON.stringify(baselinesFile(), null, 4)}\n`;
    await writeFile(baselinesPath, original);
    const runArgs = [];
    for (const [index, bytes] of [990, 1000, 985].entries()) {
        const dir = path.join(workDir, `run-${index + 1}`);
        await mkdir(dir, { recursive: true });
        await writeFile(
            path.join(dir, 'initial-bytes.summary.json'),
            JSON.stringify(bytesRun(bytes))
        );
        await writeFile(
            path.join(dir, 'journeys.summary.json'),
            JSON.stringify(run({ counters: { 'renderer.longTasks': 2 } }))
        );
        runArgs.push('--run', dir);
    }
    const cli = (...extra) =>
        spawnSync(
            process.execPath,
            [
                scriptPath,
                ...runArgs,
                '--baselines',
                baselinesPath,
                '--evidence-run',
                RUN_URL,
                ...extra,
            ],
            { encoding: 'utf8' }
        );

    const unchanged = cli();
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.match(unchanged.stdout, /nothing to tighten/);
    assert.equal(await readFile(baselinesPath, 'utf8'), original);

    await writeFile(
        path.join(workDir, 'run-2', 'initial-bytes.summary.json'),
        JSON.stringify(bytesRun(970))
    );
    const reportPath = path.join(workDir, 'report.md');
    const tightened = cli('--report', reportPath, '--date', '2026-10-05');
    assert.equal(tightened.status, 0, tightened.stderr);
    const written = JSON.parse(await readFile(baselinesPath, 'utf8'));
    assert.equal(written.journeys.launch['renderer.initialBytes'].value, 990);
    assert.match(await readFile(reportPath, 'utf8'), /lowered to 990 bytes/);

    const fill = spawnSync(
        process.execPath,
        [
            scriptPath,
            '--baselines',
            baselinesPath,
            '--evidence-run',
            RUN_URL,
            '--fill-evidence-pr',
            '1800',
        ],
        { encoding: 'utf8' }
    );
    assert.equal(fill.status, 0, fill.stderr);
    const filled = JSON.parse(await readFile(baselinesPath, 'utf8'));
    assert.equal(
        filled.journeys.launch['renderer.initialBytes'].evidencePr,
        1800
    );

    const tooFew = spawnSync(
        process.execPath,
        [
            scriptPath,
            '--run',
            path.join(workDir, 'run-1'),
            '--evidence-run',
            RUN_URL,
        ],
        { encoding: 'utf8' }
    );
    assert.equal(tooFew.status, 1);
    assert.match(tooFew.stderr, /at least 3 runs; received 1/);
});
