import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import {
    DEFAULT_HEAD_PATH,
    compareBaselineDirection,
    formatDirectionResult,
    parseArgs,
} from './check-baseline-direction.mjs';

const scriptPath = fileURLToPath(
    new URL('./check-baseline-direction.mjs', import.meta.url)
);

const file = (initialBytes, extra = {}) => ({
    version: 1,
    journeys: {
        launch: {
            'renderer.initialBytes': { value: initialBytes, unit: 'bytes' },
            ...extra,
        },
    },
});

let workDir;
before(async () => {
    workDir = await mkdtemp(
        path.join(os.tmpdir(), 'check-baseline-direction-')
    );
});
after(async () => {
    await rm(workDir, { recursive: true, force: true });
});

test('an unchanged or lowered baseline passes', () => {
    const same = compareBaselineDirection({ base: file(100), head: file(100) });
    assert.deepEqual(same.failures, []);
    assert.deepEqual(same.unchanged, ['launch/renderer.initialBytes']);

    const lowered = compareBaselineDirection({
        base: file(100),
        head: file(90),
    });
    assert.deepEqual(lowered.failures, []);
    assert.match(lowered.lowered[0], /100 -> 90 bytes/);
});

test('a raised baseline fails with both values', () => {
    const result = compareBaselineDirection({
        base: file(100),
        head: file(101),
    });
    assert.equal(result.failures.length, 1);
    assert.match(
        result.failures[0],
        /raised from 100 to 101 bytes\. Baselines only move down/
    );
});

test('a removed baseline fails; a new one is reported and passes', () => {
    const removed = compareBaselineDirection({
        base: file(100, { cdTicks: { value: 5 } }),
        head: file(100),
    });
    assert.equal(removed.failures.length, 1);
    assert.match(
        removed.failures[0],
        /launch\/cdTicks: baseline 5 was removed/
    );

    const added = compareBaselineDirection({
        base: file(100),
        head: file(100, { cdTicks: { value: 5 } }),
    });
    assert.deepEqual(added.failures, []);
    assert.deepEqual(added.added, ['launch/cdTicks']);
});

test('an empty target-branch file cannot be weakened', () => {
    const result = compareBaselineDirection({
        base: { journeys: {} },
        head: file(100),
    });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.added, ['launch/renderer.initialBytes']);
});

test('formats the outcome', () => {
    assert.match(
        formatDirectionResult(
            compareBaselineDirection({ base: file(100), head: file(90) })
        ),
        /^lowered {2}launch\/renderer\.initialBytes: 100 -> 90 bytes\.\nBaseline direction OK: 0 unchanged, 1 lowered, 0 added\.$/
    );
    assert.match(
        formatDirectionResult(
            compareBaselineDirection({ base: file(100), head: file(200) })
        ),
        /^FAIL {5}launch.*\nBaseline direction check failed: 1 entries raised or removed\.$/
    );
});

test('parses arguments and requires --base', () => {
    assert.deepEqual(parseArgs(['--base', 'b.json']), {
        base: 'b.json',
        head: DEFAULT_HEAD_PATH,
    });
    assert.deepEqual(parseArgs(['--', '--base=b.json', '--head=h.json']), {
        base: 'b.json',
        head: 'h.json',
    });
    assert.throws(
        () => parseArgs([]),
        /--base <target-branch-journey-baselines\.json> is required/
    );
    assert.throws(() => parseArgs(['--base']), /Missing value for --base/);
    assert.throws(
        () => parseArgs(['--base', 'b', '--force']),
        /Unknown argument: --force/
    );
});

async function runCli(base, head) {
    const basePath =
        base === null
            ? path.join(workDir, 'absent.json')
            : path.join(workDir, `base-${Math.random()}.json`);
    const headPath = path.join(workDir, `head-${Math.random()}.json`);
    if (base !== null) await writeFile(basePath, JSON.stringify(base));
    await writeFile(headPath, JSON.stringify(head));
    return spawnSync(
        process.execPath,
        [scriptPath, '--base', basePath, '--head', headPath],
        {
            encoding: 'utf8',
        }
    );
}

test('CLI exits 0 for a lowered baseline, 1 for a raised one, 0 when the target branch has no file', async () => {
    const lowered = await runCli(file(100), file(90));
    assert.equal(lowered.status, 0, lowered.stderr);
    assert.match(lowered.stdout, /Baseline direction OK/);

    const raised = await runCli(file(100), file(101));
    assert.equal(raised.status, 1);
    assert.match(
        raised.stderr,
        /FAIL {5}launch\/renderer\.initialBytes: baseline raised/
    );

    const noBase = await runCli(null, file(100));
    assert.equal(noBase.status, 0, noBase.stderr);
    assert.match(noBase.stdout, /nothing to weaken/);
});
