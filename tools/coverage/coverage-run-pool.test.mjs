import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import {
    countSpecFiles,
    formatDuration,
    integerEnv,
    integerFlag,
    orderLongestFirst,
    resolveConcurrency,
    resolveWorkersPerProject,
    runWithConcurrency,
} from './coverage-run-pool.mjs';

let workDir;
before(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'coverage-run-pool-'));
});
after(async () => {
    await rm(workDir, { recursive: true, force: true });
});

test('counts spec and test files recursively and ignores sources', async () => {
    const root = path.join(workDir, 'lib');
    await mkdir(path.join(root, 'nested', 'deeper'), { recursive: true });
    await writeFile(path.join(root, 'a.spec.ts'), '');
    await writeFile(path.join(root, 'a.ts'), '');
    await writeFile(path.join(root, 'nested', 'b.test.ts'), '');
    await writeFile(path.join(root, 'nested', 'deeper', 'c.spec.ts'), '');
    await writeFile(path.join(root, 'nested', 'deeper', 'c.spec.ts.snap'), '');
    assert.equal(countSpecFiles(root), 3);
    assert.equal(countSpecFiles(path.join(workDir, 'missing')), 0);
});

test('orders longest first and keeps policy order for ties', () => {
    const projects = [
        { name: 'small' },
        { name: 'big' },
        { name: 'medium' },
        { name: 'also-small' },
    ];
    const weights = { small: 2, big: 50, medium: 10, 'also-small': 2 };
    assert.deepEqual(
        orderLongestFirst(projects, (project) => weights[project.name]).map((p) => p.name),
        ['big', 'medium', 'small', 'also-small']
    );
});

test('derives concurrency and workers from the core count unless overridden', () => {
    assert.equal(resolveConcurrency({ requested: undefined, cpuCount: 4 }), 3);
    assert.equal(resolveConcurrency({ requested: undefined, cpuCount: 2 }), 1);
    assert.equal(resolveConcurrency({ requested: undefined, cpuCount: 16 }), 3);
    assert.equal(resolveConcurrency({ requested: 5, cpuCount: 2 }), 5);
    assert.equal(resolveWorkersPerProject({ requested: undefined, concurrency: 3, cpuCount: 4 }), 2);
    assert.equal(resolveWorkersPerProject({ requested: undefined, concurrency: 1, cpuCount: 4 }), 4);
    assert.equal(resolveWorkersPerProject({ requested: 1, concurrency: 3, cpuCount: 16 }), 1);
});

function task(name, { delay = 0, status = 0, log }) {
    return {
        name,
        run: () =>
            new Promise((resolve) => {
                log.push(`start ${name}`);
                setTimeout(() => {
                    log.push(`end ${name}`);
                    resolve({ status });
                }, delay);
            }),
    };
}

test('keeps at most `concurrency` tasks in flight and reports results in start order', async () => {
    const log = [];
    const tasks = [
        task('a', { delay: 30, log }),
        task('b', { delay: 10, log }),
        task('c', { delay: 10, log }),
        task('d', { delay: 5, log }),
    ];
    const settled = [];
    const outcome = await runWithConcurrency(tasks, {
        concurrency: 2,
        onSettled: (result) => settled.push(result.name),
    });
    assert.equal(outcome.failed, false);
    assert.deepEqual(outcome.skipped, []);
    assert.deepEqual(outcome.results.map((r) => r.name), ['a', 'b', 'c', 'd']);
    // b finishes before a, so the third task starts before a ends.
    assert.ok(log.indexOf('start c') < log.indexOf('end a'));
    assert.ok(log.indexOf('start c') > log.indexOf('end b'));
    assert.ok(outcome.results.every((r) => r.status === 0 && r.durationMs >= 0));
    assert.equal(settled.length, 4);
});

test('fails fast: a failure stops new tasks but lets running ones finish', async () => {
    const log = [];
    const tasks = [
        task('a', { delay: 40, log }),
        task('b', { delay: 5, status: 1, log }),
        task('c', { delay: 5, log }),
        task('d', { delay: 5, log }),
    ];
    const outcome = await runWithConcurrency(tasks, { concurrency: 2 });
    assert.equal(outcome.failed, true);
    assert.deepEqual(outcome.skipped, ['c', 'd']);
    assert.deepEqual(outcome.results.map((r) => [r.name, r.status]), [['a', 0], ['b', 1]]);
    assert.ok(log.includes('end a'), 'the running task was awaited');
});

test('a task that throws counts as a failure with the error attached', async () => {
    const outcome = await runWithConcurrency(
        [{ name: 'boom', run: () => Promise.reject(new Error('spawn failed')) }],
        { concurrency: 1 }
    );
    assert.equal(outcome.failed, true);
    assert.match(outcome.results[0].error.message, /spawn failed/);
});

test('formats durations and parses integer flags', () => {
    assert.equal(formatDuration(4200), '4s');
    assert.equal(formatDuration(125000), '2m 05s');
    assert.equal(integerFlag(['--concurrency=3'], 'concurrency'), 3);
    assert.equal(integerFlag(['--projects=a'], 'concurrency'), undefined);
    assert.throws(() => integerFlag(['--concurrency=0'], 'concurrency'), /positive integer/);
    assert.throws(() => integerFlag(['--max-workers=two'], 'max-workers'), /positive integer/);
    assert.equal(integerEnv({}, 'TIER_A_CONCURRENCY'), undefined);
    assert.equal(integerEnv({ TIER_A_CONCURRENCY: '' }, 'TIER_A_CONCURRENCY'), undefined);
    assert.equal(integerEnv({ TIER_A_CONCURRENCY: '2' }, 'TIER_A_CONCURRENCY'), 2);
    assert.throws(() => integerEnv({ TIER_A_CONCURRENCY: 'x' }, 'TIER_A_CONCURRENCY'), /positive integer/);    // Prefixes and fractions are rejected, not truncated.
    assert.throws(() => integerFlag(['--concurrency=3oops'], 'concurrency'), /positive integer/);
    assert.throws(() => integerFlag(['--concurrency=2.5'], 'concurrency'), /positive integer/);
    assert.throws(() => integerEnv({ TIER_A_MAX_WORKERS: '2.5' }, 'TIER_A_MAX_WORKERS'), /positive integer/);
    assert.throws(() => integerEnv({ TIER_A_MAX_WORKERS: '-1' }, 'TIER_A_MAX_WORKERS'), /positive integer/);
    assert.equal(integerEnv({ TIER_A_MAX_WORKERS: ' 4 ' }, 'TIER_A_MAX_WORKERS'), 4);
});
